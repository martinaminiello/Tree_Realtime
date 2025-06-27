import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getcredentials } from "/credentials.js";



// Firebase configuration
const firebaseConfig = getcredentials();
console.log(firebaseConfig);

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);




//cache
function generateCacheArray(tree, lastModifiedMap, basePath = '') {
  const result = [];

  function traverse(node, currentPath = '') {
    for (const key in node) {
      const value = node[key];
      const fullPath = currentPath ? `${currentPath}/${key}` : key;

      if (typeof value === 'object' && value !== null && 'content' in value && 'last-modifier' in value) {
        const meta = lastModifiedMap[fullPath];

        if (meta) {
          result.push({  
              content: value.content,
              push_status: "in-progress",
              path: fullPath,
              timestamp: Timestamp.now(),
              uuid_cache: meta.uuid_cache,
         
            
          });
        }
      }
      

      // If it's a folder, recurse
      else if (typeof value === 'object' && value !== null) {
        traverse(value, fullPath);
      }
    }
  }

  traverse(tree, basePath);
  return result;
}


async function writeCacheToFirestore(projectId, cacheArray) {
  const firestore = getFirestore();
  const cacheDocRef = doc(firestore, "cache", projectId);

  // Controllo campi undefined PRIMA di scrivere
  cacheArray.forEach((item, index) => {
    Object.entries(item).forEach(([key, value]) => {
      if (value === undefined) {
        console.warn(`Undefined value found in item ${index}, field '${key}'`);
      }
    });
  });

  try {
    await setDoc(cacheDocRef, { queue_item: cacheArray });
    console.log(`Cache for project ${projectId} written successfully`);
  } catch (error) {
    console.log(`writing cache`);
    console.log(JSON.stringify(cacheArray, null, 2));
    console.error(`Error writing cache:`, error);
  }
}


//last-modified
function generateLastModifiedMap(tree, basePath = '') {
  const result = {};

  for (const key in tree) {
    const value = tree[key];
    const currentPath = basePath ? `${basePath}/${key}` : key;

    // If it's a file
    if (typeof value === 'object' && value !== null && 'content' in value && 'last-modifier' in value) {
      result[currentPath] = {
        _name: key,
        "last-modifier": value["last-modifier"],
        timestamp:Timestamp.now(), // Firestore will store this as a timestamp
        uuid_cache: crypto.randomUUID()
      };
    }

    // If it's a folder
    else if (typeof value === 'object' && value !== null) {
      const nested = generateLastModifiedMap(value, currentPath);
      Object.assign(result, nested);
    }
  }

  return result;
}



function transform_into_Firestore_tree(tree) {
  const result = {};

  for (const key in tree) {
    const value = tree[key];

    // If it's a file
    if (typeof value === 'object' && value !== null && 'content' in value) {
      result[key] = "";
    }

    // If it's a folder (nested structure)
    else if (typeof value === 'object' && value !== null) {
      const nested = transform_into_Firestore_tree(value);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
    }
  }

  return result;
}



// Helper to update current authors
function updateCurrentAuthors(currentAuthorsArray, author) {
  if (!currentAuthorsArray.includes(author)) {
    currentAuthorsArray.push(author);
  }
  return currentAuthorsArray;
}

// Helper to retrieve fields from Firestore
async function fetch(firestore, projectPath, field) {
  const projectRef = doc(firestore, projectPath);
  const snapshot = await getDoc(projectRef);
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  const fieldData = data[field];

  if (!fieldData) return null;

  if (typeof fieldData === 'object' && !Array.isArray(fieldData)) {
    return Object.values(fieldData);
  }

  return fieldData;
}

// Open project (create if it doesn't exist with current author or add another current author)
async function open_project(firestore, id, author, projectData) {
  const projectPath = `projects/${id}`;
  const projectRef = doc(firestore, projectPath);
  const snapshot = await getDoc(projectRef);

  if (snapshot.exists()) {
    const data = snapshot.data();
    let currentAuthors = data["current-authors"] || [];

    if (!Array.isArray(currentAuthors)) {
      currentAuthors = Object.values(currentAuthors);
    }

    currentAuthors = updateCurrentAuthors(currentAuthors, author);

    await updateDoc(projectRef, { "current-authors": currentAuthors });
    alert("Another author is activating the project...");
    console.log("Project already existed. Updated current-authors:", currentAuthors);
  } else {
    await setDoc(projectRef, {
      ...projectData,
      "current-authors": [author]
    });
    alert("Project activation");
    console.log("Project activated on Firestore");
    
    
  }
}

// extract path, uuid, modified flag from metadata so we can identify changes
function getData_from_metadata(obj, path = "") {
  let files = [];

  for (const key in obj) {
    if (["uuid", "content", "last-modifier"].includes(key)) continue;

    const val = obj[key];
    const currentPath = path ? `${path}/${key}` : key;

    if (typeof val === "object") {
      files.push({ path: currentPath, uuid: val.uuid, modified: val.modified === "true" });
      files = files.concat(getData_from_metadata(val, currentPath));
    }
  }

  return files;
}


//we turn Firestore tree in a structure similar to the metadata so it's easier to compare
function rebuildFirestoreAsMetadata(tree, basePath = "") {
  const result = {};

  for (const uuid in tree) {
    const node = tree[uuid];

    if (typeof node === "string") {
      // caso semplice: file singolo
      const path = basePath ? `${basePath}/${node}` : node;
      result[path] = { uuid };
    } else if (typeof node === "object" && node._name) {
      const folderName = node._name;
      const folderPath = basePath ? `${basePath}/${folderName}` : folderName;

      result[folderPath] = { uuid };

      // itero tutte le chiavi dentro il nodo
      for (const innerUuid in node) {
        if (innerUuid === "_name") continue;

        const value = node[innerUuid];

        if (typeof value === "string") {
          // file singolo dentro questa cartella
          const filePath = `${folderPath}/${value}`;
          result[filePath] = { uuid: innerUuid };
        } else if (typeof value === "object" && value._name) {
          // sotto-cartella
          const subTree = { [innerUuid]: value };
          const subResult = rebuildFirestoreAsMetadata(subTree, folderPath);
          Object.assign(result, subResult);
        }
      }
    }
  }

  return result;
}




function compareFileLists(localList, firestoreList) {
  const result = {
    unchanged: [],
    modified: [],
    added: [],
    deleted: [],
    renamed_or_moved: []
  };

  const firestoreByPath = Object.fromEntries(firestoreList.map(f => [f.path, f]));
  const firestoreByUuid = Object.fromEntries(firestoreList.map(f => [f.uuid, f]));
  const localByUuid = Object.fromEntries(
    localList
      .filter(f => f.uuid && typeof f.uuid === "string" && f.uuid.trim() !== "")
      .map(f => [f.uuid, f])
  );

  const seenUuids = new Set();

  for (const localFile of localList) {
    const { path: localPath, uuid: localUuid, modified } = localFile;

    // Caso 1: uuid mancante, vuoto o non valido → file nuovo
    if (!("uuid" in localFile) || !localUuid || typeof localUuid !== "string" || localUuid.trim() === "") {
      result.added.push(localFile);
      continue;
    }

    seenUuids.add(localUuid);

    const remoteFileByPath = firestoreByPath[localPath];
    const remoteFileByUuid = firestoreByUuid[localUuid];

    if (remoteFileByPath && remoteFileByPath.uuid === localUuid) {
      if (modified) {
        result.modified.push(localFile);
      } else {
        result.unchanged.push(localFile);
      }
    } else if (remoteFileByUuid) {
      // UUID esiste ma path diverso → spostato o rinominato
      if (remoteFileByUuid.path !== localPath) {
        result.renamed_or_moved.push({
          oldPath: remoteFileByUuid.path,
          newPath: localPath,
          uuid: localUuid
        });
      }
    } else {
      // UUID valido ma non presente nel remote → nuovo file
      result.added.push(localFile);
    }
  }

  // File cancellati: esistono in firestore ma non più nel metadata
  for (const remoteFile of firestoreList) {
    if (!seenUuids.has(remoteFile.uuid)) {
      result.deleted.push(remoteFile);
    }
  }

  return result;
}

//retrieves new metadata to know last-modifer
function getMetaFromMetadataPath(path, metadata) {
  const parts = path.split("/");
  let node = metadata;
  
  for (const part of parts) {
    if (!node || typeof node !== 'object' || !(part in node)) return null;
    node = node[part];
  }
  
  return node;
}


async function update_last_modified(id,to_add, to_modifiy_content, to_rename_or_move, to_delete, lastModified_items, new_metadata) {
  const firestore = getFirestore();
  const document_path = `projects/${id}`;
  console.log("Firestore path: ", document_path)
  const last_modifiedRef = doc(firestore, document_path);
  
  // retrieve current last-modified map
  const snapshot = await getDoc(last_modifiedRef);
  let old_last_modified = snapshot.exists() ? snapshot.data()["last-modified"] || {} : {};
  console.log("Old map last-modified:", old_last_modified);

  // created last modified map with the updated file system
  const new_last_modified = generateLastModifiedMap(new_metadata);
  console.log("New last-modified: ", new_last_modified)

  // paths must be added to the last-modified map
  to_add.forEach(item => {
    const meta = new_last_modified[item.path];
    if (meta) {
      old_last_modified[item.path] = meta;
    }
  });

  console.log("AFTER ADDITION:", old_last_modified);

  // modified content: only uuid_cache, last-modifer and timestamp need to be updated
  to_modifiy_content.forEach(item => {
    if (old_last_modified[item.path]) {
      old_last_modified[item.path].timestamp = Timestamp.now();
      old_last_modified[item.path].uuid_cache = crypto.randomUUID();
      const meta = getMetaFromMetadataPath(item.path, new_metadata);
      if (meta && meta["last-modifier"]) {
        old_last_modified[item.path]["last-modifier"] = meta["last-modifier"];
      }
    }
  });
   console.log("AFTER MODIFY CONTENT:", old_last_modified);
  
  to_rename_or_move.forEach(item => {
    if (old_last_modified[item.oldPath]) {
      
      const updated = {
        ...old_last_modified[item.oldPath],
        _name: item.newPath.split("/").pop(),
        timestamp: Timestamp.now(),
        uuid_cache: crypto.randomUUID(),
        "last-modifier": (() => {
        const meta = getMetaFromMetadataPath(item.newPath, new_metadata);
        console.log("meta for last-modifier:", meta);
        return meta && meta["last-modifier"] ? meta["last-modifier"] : old_last_modified[item.oldPath]["last-modifier"];
      })()
      };
       console.log("old path: ",old_last_modified[item.oldPath])
       console.log("_name: ",item.newPath.split("/").pop())
       console.log("last-modifier: ",old_last_modified[item.oldPath]["last-modifier"])
      // add new path and remove old path
      old_last_modified[item.newPath] = updated;
      delete old_last_modified[item.oldPath];
    }
  });
  console.log("AFTER RENOMINATION OR MOVEMENT:", old_last_modified);


  // remove from last-modified
  to_delete.forEach(item => {
    delete old_last_modified[item.path];
  });
  console.log("AFTER DELETION:", old_last_modified);
  // save to Firestore 
  try {
    await updateDoc(last_modifiedRef, { "last-modified": old_last_modified });
    console.log("Last-modified successfully updated.");
  } catch (error) {
    console.error("Error in updating last-modified:", error);
  }


}

async function update_cache_array(relevantItems, metadata) {
  const cacheArray = [];
  console.log("relevant item: ", relevantItems);
  
  relevantItems.forEach(item => {
    const path = item.path || item.newPath;
    console.log("Looking for meta with path:", path);
    const meta = getMetaFromMetadataPath(path, metadata);
    console.log("Meta found:", meta);
    console.log("Meta modified:", meta?.modified);
    
    if (meta) {
      // Creo l'oggetto base
      const itemObj = {
        content: meta.content || "",
        push_status: "in-progress",
        path: path,
        timestamp: Timestamp.now(),
        uuid_cache: crypto.randomUUID(),
        uuid: meta.uuid || ""
      };
      
      // Aggiungo 'modified' solo se 'content' esiste (cioè è un file)
      if (meta.hasOwnProperty('content')) {
        itemObj.modified = meta.modified || false;
      }
      
      cacheArray.push(itemObj);
    }
  });
  
  await writeCacheToFirestore("cache", cacheArray);
}




// update project
async function update_project(id, new_metadata) {
  const treePath = `projects/${id}`;
  const treeRef = doc(firestore, treePath);

  // Retrieves old tree from Firestore
  const snapshot = await getDoc(treeRef);
  const oldTree = snapshot.exists() ? snapshot.data().tree || {} : {};
  console.log("Firestore tree: ", oldTree)
  
  //let's turn firestore tree into something comparable with the new metadata
  const localList = getData_from_metadata(new_metadata);
  console.log("Files extracted from new metadatada: ", localList)
  const firestoreStructure = rebuildFirestoreAsMetadata(oldTree);
  const firestoreList = getData_from_metadata(firestoreStructure);
  console.log("Files extracted from firestore: ", firestoreList)

  const comparison = compareFileLists(localList, firestoreList);

  console.log("➕ Added:", comparison.added);
  console.log("➖ Deleted:", comparison.deleted);
  console.log("🟡 Modified:", comparison.modified);
  console.log("🔄 Renamed or Moved:", comparison.renamed_or_moved); //same uuid
  console.log("✅ Unchanged:", comparison.unchanged);
 
  // writes in cache
  const cache_items = [
  ...comparison.added,
  ...comparison.modified,
  ...comparison.renamed_or_moved
];
  await update_cache_array( cache_items, new_metadata);

  //updates last-modified
  const lastModified_items = [
  ...comparison.added,
  ...comparison.modified,
  ...comparison.renamed_or_moved,

];
  await update_last_modified(id, comparison.added,comparison.modified, comparison.renamed_or_moved , comparison.deleted, lastModified_items, new_metadata)



  

  console.log('Update completed');
}



// Close project (remove current author or delete document if none left)
async function close_project(firestore, id, author) {
  const projectPath = `projects/${id}`;
  let currentAuthors = await fetch(firestore, projectPath, "current-authors");

  if (!Array.isArray(currentAuthors)) {
    currentAuthors = currentAuthors ? Object.values(currentAuthors) : [];
  }

  currentAuthors = currentAuthors.filter(a => a !== author);

  const projectRef = doc(firestore, projectPath);
  if (currentAuthors.length === 0) {
    await deleteDoc(projectRef);
    console.log(`Project ${id} deleted from Firestore.`);
  } else {
    await updateDoc(projectRef, {
      "current-authors": currentAuthors
    });
    console.log(`Removed author ${author} from current-authors.`);
  }
}

// DELETE project PERMANENTLY (also from firestore and github)
async function delete_project(firestore, id) {
  const projectPath = `projects/${id}`;
  const docRef = doc(firestore, projectPath);
  await deleteDoc(docRef);
  console.log(`Project ${id} deleted from Firestore.`);

  const archiveRef = doc(firestore, "projects", id);
  await deleteDoc(archiveRef);
  console.log(`Project ${id} deleted from 'projects' collection.`);
}

// buttons
window.addEventListener("DOMContentLoaded", () => {
  const openBtn = document.getElementById("open");
  const closeBtn = document.getElementById("close");
  const updateBtn = document.getElementById("update");
  const deleteBtn = document.getElementById("delete");

  if (openBtn) {
    openBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const author = button.getAttribute("data-author");
      const id = button.getAttribute("data-project-id");
      const title = button.getAttribute("data-title");
      const data_tree = button.getAttribute("data-tree");
      const rawtree = JSON.parse(data_tree);
      const lastModified = generateLastModifiedMap(rawtree);
      const tree = transform_into_Firestore_tree(rawtree);
      const co_authors = JSON.parse(button.getAttribute("data-co-authors"));
      const cacheArray = generateCacheArray(rawtree, lastModified);

      

      const projectData = { id, title,"last-modified": lastModified, "co-authors": co_authors };

      console.log("projectData:", projectData);
      await open_project(firestore, id, author, projectData);
      await writeCacheToFirestore("cache", cacheArray);
     
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const author = button.getAttribute("data-author");
      const id = button.getAttribute("data-project-id");

      alert(`Closing project for ${author}...`);
      await close_project(firestore, id, author);
    });
  }

  if (updateBtn) {
    updateBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const id = button.getAttribute("data-project-id");
      const data_tree = button.getAttribute("data-tree");
      const metadata = JSON.parse(data_tree);

      alert(`Updating project...`);
      await update_project(id, metadata);
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const id = button.getAttribute("data-project-id");

      alert(`Deleting project ${id}...`);
      await delete_project(firestore, id);
    });
  }
});
