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

  // check for undefined values
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


function generateLastModifiedMap(tree, basePath = '') {
  const result = {};

  for (const key in tree) {
    const value = tree[key];
    const currentPath = basePath ? `${basePath}/${key}` : key;

    // file contains content
    if (typeof value === 'object' && value !== null && 'content' in value && 'last-modifier' in value) {
      result[currentPath] = {
        _name: key,
        "last-modifier": value["last-modifier"],
        timestamp: Timestamp.now(),
        uuid_cache: value.uuid_cache || crypto.randomUUID()
      };
    }

    // folder
    else if (typeof value === 'object' && value !== null) {
      const nested = generateLastModifiedMap(value, currentPath);
      Object.assign(result, nested);
    }
  }

  return result;
}



// Open project (create if it doesn't exist with current author or add another current author)
async function open_project(firestore, id, projectData) {
  const projectPath = `projects/${id}`;
  const projectRef = doc(firestore, projectPath);
  const snapshot = await getDoc(projectRef);

  if (snapshot.exists()) {
   
     alert("Project already exists");
    console.log("Project already exist.");
  } else {
    await setDoc(projectRef, {
      ...projectData,
      
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
      const isFile = "uuid" in val && "content" in val; // file has both uuid and content
      if (isFile) {
        files.push({
          path: currentPath,
          uuid: val.uuid,
          modified: val.modified === true || val.modified === "true"
        });
      } else {
        // directory or nested structure
        files = files.concat(getData_from_metadata(val, currentPath));
      }
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
      // file
      const path = basePath ? `${basePath}/${node}` : node;
      result[path] = { uuid };
    } else if (typeof node === "object" && node._name) {
      const folderName = node._name;
      const folderPath = basePath ? `${basePath}/${folderName}` : folderName;

      result[folderPath] = { uuid };

      // iteration
      for (const innerUuid in node) {
        if (innerUuid === "_name") continue;

        const value = node[innerUuid];

        if (typeof value === "string") {
          // file in folder
          const filePath = `${folderPath}/${value}`;
          result[filePath] = { uuid: innerUuid };
        } else if (typeof value === "object" && value._name) {
          // sub-folder
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

  const firestoreByUuid = Object.fromEntries(firestoreList.map(f => [f.uuid, f]));
  const localByUuid = Object.fromEntries(localList.map(f => [f.uuid, f]));

  const seenUuids = new Set();

  for (const localFile of localList) {
    const { uuid: localUuid, path: localPath, modified } = localFile;

    // invalid, absent or empty UUID 
    if (!localUuid || typeof localUuid !== "string" || localUuid.trim() === "") {
      result.added.push(localFile);
      continue;
    }

    const remoteFile = firestoreByUuid[localUuid];

    if (remoteFile) {
      seenUuids.add(localUuid);

      if (remoteFile.path !== localPath) {
        result.renamed_or_moved.push({
          uuid: localUuid,
          oldPath: remoteFile.path,
          newPath: localPath
        });
      }

      if (modified) {
        result.modified.push(localFile);
      } else {
        result.unchanged.push(localFile);
      }
    } else {
      result.added.push(localFile);
    }
  }

  // deleted: uuid is in Firestore but not in metadata
  for (const remoteFile of firestoreList) {
    if (!localByUuid[remoteFile.uuid]) {
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


async function update_last_modified(id, to_add, to_modifiy_content, to_rename_or_move, to_delete, lastModified_items, new_metadata, new_last_modified ) {
 const firestore = getFirestore();
  const document_path = `projects/${id}`;
  const last_modifiedRef = doc(firestore, document_path);

  const snapshot = await getDoc(last_modifiedRef);
  let old_last_modified = snapshot.exists() ? snapshot.data()["last-modified"] || {} : {};

  // Add new files
  to_add.forEach(item => {
    const meta = new_last_modified[item.path];
    if (meta) {
      old_last_modified[item.path] = meta;
    }
  });

  // Modify content
  to_modifiy_content.forEach(item => {
    const meta = new_metadata && getMetaFromMetadataPath(item.path, new_metadata);
    const updated = new_last_modified[item.path];
    if (updated && old_last_modified[item.path]) {
      old_last_modified[item.path] = updated;
    }
  });

  // Rename or move
  to_rename_or_move.forEach(item => {
    const updated = new_last_modified[item.newPath];
    if (updated && old_last_modified[item.oldPath]) {
      old_last_modified[item.newPath] = updated;
      delete old_last_modified[item.oldPath];
    }
  });

  // Delete
  to_delete.forEach(item => {
    delete old_last_modified[item.path];
  });

  try {
    await updateDoc(last_modifiedRef, { "last-modified": old_last_modified });
    console.log("Last-modified successfully updated.");
  } catch (error) {
    console.error("Error in updating last-modified:", error);
  }
}


async function update_cache_array(relevantItems, to_delete, metadata, new_last_modified) {
  const cacheArray = [];

  // only files
  const filteredRelevantItems = relevantItems.filter(item => {
    const path = item.path || item.newPath;
    const meta = getMetaFromMetadataPath(path, metadata);
    return meta && meta.hasOwnProperty("content");
  });

  filteredRelevantItems.forEach(item => {
    const path = item.path || item.newPath;
    const meta = getMetaFromMetadataPath(path, metadata);
    const lm = new_last_modified[path];

    if (!meta || !lm) return;

    const itemObj = {
      content: meta.content || "",
      push_status: "in-progress",
      path: path,
      timestamp: Timestamp.now(),
      uuid_cache: lm.uuid_cache, // from last-modified
      uuid: meta.uuid || "",
      modified: meta.modified || false
    };

    cacheArray.push(itemObj);
  });

  to_delete.forEach(item => {
    const path = item.path || item.newPath;
    const meta = getMetaFromMetadataPath(path, metadata);
    const lm = new_last_modified[path];

    const itemObj = {
      push_status: "in-progress",
      path: path,
      uuid: item.uuid || "",
      to_delete: true
    };

    if (meta?.hasOwnProperty('content')) {
      itemObj.modified = meta.modified || false;
    }

    cacheArray.push(itemObj);
  });

  console.log("CACHE ARRAY:", cacheArray);
  await writeCacheToFirestore("cache", cacheArray);
}





function flatMetadataToList(flat) {
  const files = [];

  for (const path in flat) {
    const meta = flat[path];

    console.log("[FLATMETADATA] path:", path, "meta:", meta, "modified:", meta.modified);

    // files are the ones with a path that includes a dot
    if (path.includes(".") && typeof meta === "object" && meta.uuid) {
      files.push({
        path,
        uuid: meta.uuid,
        modified: meta.modified 
      });
    }
  }

  return files;
}



// update project
async function update_project(id, new_metadata, title, co_authors) {
  //retrieves title and co-authors
  const projectPath = `projects/${id}`;
  const projectRef = doc(firestore, projectPath);
  const snapshot = await getDoc(projectRef);

  //retrieves old title and co-authors
  const old_title = snapshot.exists() ? snapshot.data().title || {} : {};
  console.log("Firestore title: ", title)
  const old_co_authors = snapshot.exists() ? snapshot.data()["co-authors"] ?? [] : [];
  console.log("Firestore co-authors: ", old_co_authors)

  if (title !== old_title || JSON.stringify(co_authors) !== JSON.stringify(old_co_authors)) {
    //updates title and co-authors
    await updateDoc(projectRef, {
      title: title,
      "co-authors": co_authors
    });
    console.log("Title and co-authors updated in Firestore");
  }


  // Retrieves old tree from Firestore
  const oldTree = snapshot.exists() ? snapshot.data().tree || {} : {};
  console.log("Firestore tree: ", oldTree)
  
  console.log("NEW METADATA: ",  new_metadata)
  //let's turn firestore tree into something comparable with the new metadata
  const localList = getData_from_metadata(new_metadata);
  console.log("Files extracted from new metadatada: ", localList)
  const firestoreStructure = rebuildFirestoreAsMetadata(oldTree);
  const firestoreList = flatMetadataToList(firestoreStructure);
  console.log("Files extracted from firestore: ", firestoreList)

  const new_last_modified = generateLastModifiedMap(new_metadata);

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
  const deleted = [
  ...comparison.deleted,
  ...comparison.renamed_or_moved.map(item => ({
    path: item.oldPath,
    uuid: item.uuid
  }))
];
  await update_cache_array(cache_items, deleted, new_metadata, new_last_modified);

  //updates last-modified
  const lastModified_items = [
  ...comparison.added,
  ...comparison.modified,
  ...comparison.renamed_or_moved,

];
  await update_last_modified(id, comparison.added,comparison.modified, comparison.renamed_or_moved , comparison.deleted, lastModified_items, new_metadata, new_last_modified)



  

  console.log('Update completed');
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
  const updateBtn = document.getElementById("update");
  const deleteBtn = document.getElementById("delete");

  if (openBtn) {
    openBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const id = button.getAttribute("data-project-id");
      const title = button.getAttribute("data-title");
      const data_tree = button.getAttribute("data-tree");
      const rawtree = JSON.parse(data_tree);
      const lastModified = generateLastModifiedMap(rawtree);
      const co_authors = JSON.parse(button.getAttribute("data-co-authors"));
      const cacheArray = generateCacheArray(rawtree, lastModified);

      

      const projectData = { id, title,"last-modified": lastModified, "co-authors": co_authors };

      console.log("projectData:", projectData);
      await open_project(firestore, id, projectData);
      await writeCacheToFirestore("cache", cacheArray);
     
    });
  }

  if (updateBtn) {
    updateBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const id = button.getAttribute("data-project-id");
      const data_tree = button.getAttribute("data-tree");
      const metadata = JSON.parse(data_tree);
      const title = button.getAttribute("data-title");
      const co_authors = JSON.parse(button.getAttribute("data-co-authors"));

      alert(`Updating project...`);
      await update_project(id, metadata, title, co_authors);
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
