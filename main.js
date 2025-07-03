import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getcredentials } from "/credentials.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";



// Firebase configuration
const firebaseConfig = getcredentials();
console.log(firebaseConfig);

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);




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
    if (typeof value === 'object' && value !== null && 'content' in value && 'last-modifier' in value) {
      result[currentPath] = {
        _name: key,
        "last-modifier": value["last-modifier"],
        timestamp: Timestamp.now(),
        uuid_cache: value.uuid_cache ||  crypto.randomUUID()
      };
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, generateLastModifiedMap(value, currentPath));
    }

    console.log("timestamp", Timestamp.now());
  }
  return result;
}

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
      } else if (typeof value === 'object' && value !== null) {
        traverse(value, fullPath);
      }
    }
  }
  traverse(tree, basePath);
  return result;
}




// Open project (create if it doesn't exist with current author or add another current author)
async function open_project(firestore, id, projectData) {
   if (projectData && projectData["last-modified"]) {
    for (const key in projectData["last-modified"]) {
      const lm = projectData["last-modified"][key];
      if (lm.timestamp && typeof lm.timestamp === "object" && "seconds" in lm.timestamp && "nanoseconds" in lm.timestamp) {
        lm.timestamp = new Timestamp(lm.timestamp.seconds, lm.timestamp.nanoseconds);
      }
    }
  }
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

    console.log("[FLATMETADATA] path:", path, "meta:", meta);

    // files are the ones with a path that includes a dot
    if (path.includes(".") && typeof meta === "object" && meta.uuid) {
      files.push({
        path,
        uuid: meta.uuid
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

// avoid duplicates in case files was renames or moved and modified
const seen = new Map();
for (const item of cache_items) {
  
  const key = item.uuid + '|' + (item.path || item.newPath);
  seen.set(key, item);
}
const deduped_cache_items = Array.from(seen.values());

  const deleted = [
  ...comparison.deleted,
  ...comparison.renamed_or_moved.map(item => ({
    path: item.oldPath,
    uuid: item.uuid
  }))
];
  await update_cache_array(deduped_cache_items, deleted, new_metadata, new_last_modified);

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
      const textarea = document.getElementsByClassName("uuid-textarea")[0];
      const owners= button.getAttribute("owners");
      const data_tree = textarea ? textarea.value : "{}";
      let rawtree = {};
      try {
        rawtree = JSON.parse(data_tree);
      } catch (e) {   //temporary
        alert("Error in json in textarea: " + e.message);
        return;
}
      const co_authors = JSON.parse(button.getAttribute("data-co-authors"));

      const lastModified = generateLastModifiedMap(rawtree);
      const cacheArray = generateCacheArray(rawtree, lastModified);
  
         
      worker.postMessage({
      action: 'open',
      id,
      title,
      metadata: rawtree,
      co_authors,
      owners,
      lastModified: lastModified,
      cacheArray: cacheArray
    });
  });
}
     
 

  if (updateBtn) {
    updateBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const id = button.getAttribute("data-project-id");
      const title = button.getAttribute("data-title");
      const co_authors = JSON.parse(button.getAttribute("data-co-authors"));
      const textarea = document.getElementsByClassName("uuid-textarea")[0];
      const data_tree = textarea ? textarea.value : "{}";
      let metadata = {};
      try {
        metadata = JSON.parse(data_tree);
      } catch (e) {   //temporary
        alert("Error in json in textarea: " + e.message);
        return;
}
      console.log("METADATA FROM BOTTON", metadata);

      alert(`Updating project ${id}...`);

         worker.postMessage({
      action: 'update',
      id,
      title,
      metadata: metadata,
      co_authors
    });
  });
}
   

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const id = button.getAttribute("data-project-id");
    
      alert(`Deleting project ${id}...`);

      worker.postMessage({
      action: 'delete',
      id
    });
  });
}
});


// WORKER
const worker = new Worker('worker.js');

worker.onmessage = async (e) => {
  const { action, processedData, error } = e.data;
  if (error) {
    alert("Worker error: " + error);
    return;
  }

    if (processedData && processedData.lastModified) {
    for (const key in processedData.lastModified) {
      const lm = processedData.lastModified[key];
      if (lm.timestamp && typeof lm.timestamp === "object" && "seconds" in lm.timestamp && "nanoseconds" in lm.timestamp) {
        lm.timestamp = new Timestamp(lm.timestamp.seconds, lm.timestamp.nanoseconds);
      }
    }
  }
  if (processedData && processedData.cacheArray) {
    for (const item of processedData.cacheArray) {
      if (item.timestamp && typeof item.timestamp === "object" && "seconds" in item.timestamp && "nanoseconds" in item.timestamp) {
        item.timestamp = new Timestamp(item.timestamp.seconds, item.timestamp.nanoseconds);
      }
    }
  }
  if (action === 'open') {
    
    await open_project(firestore, processedData.id, processedData.projectData);
    await writeCacheToFirestore("cache", processedData.cacheArray);

    const lastModified = processedData.projectData["last-modified"];
    await checkItemsArePushedAndShowToast("cache", processedData.id, lastModified, action)
  }
   

    if (action === 'update') {

  await update_project(
    processedData.id,
    processedData.metadata,
    processedData.title,
    processedData.co_authors
  );


  const projectDocRef = doc(firestore, "projects", processedData.id);
  const projectSnap = await getDoc(projectDocRef);
  let lastModified = {};
  if (projectSnap.exists()) {
    lastModified = projectSnap.data()["last-modified"] || {};
  }

  
  await checkItemsArePushedAndShowToast(
    "cache",
    processedData.id,
    lastModified,
    action
  );
}


   if (action === 'delete') {
    
    await delete_project(firestore, processedData.id);
      const projectDocRef = doc(firestore, "projects", processedData.id);
  const projectSnap = await getDoc(projectDocRef);
  if (!projectSnap.exists()) {
    showToast("project deleted successfully.");
  } 
  }
};




function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "show";
  setTimeout(() => {
    toast.className = toast.className.replace("show", "");
  }, 6000); // 6 seconds
}

async function checkItemsArePushedAndShowToast(cacheId,projectId, lastModified, action) {
  let attempts = 0;
  const maxAttempts = 10; 
  const intervalMs = 3000; 
  const firestore = getFirestore();
  const cacheDocRef = doc(firestore, "cache", cacheId);

  return new Promise((resolve) => {
    const poll = async () => {
      const cacheSnap = await getDoc(cacheDocRef);
      if (!cacheSnap.exists()) {
        resolve(false);
        return;
      }
      const cacheArray = cacheSnap.data().queue_item || [];
      const lastModifiedUuids = new Set(Object.values(lastModified).map(lm => lm.uuid_cache));
      const stillPresent = cacheArray.some(item => lastModifiedUuids.has(item.uuid_cache));
      if (!stillPresent) {
        if(action=== 'open') {
        showToast("project was created in Github");
        }
        if(action === 'update') {
        showToast("project was succcessfully updated in Github");
        }

        //retrieves Firestore tree
        const projectDocRef = doc(firestore, "projects", projectId);
        const projectSnap = await getDoc(projectDocRef);
        if (projectSnap.exists()) {
          const tree = projectSnap.data().tree || {};
          const textarea = document.querySelector('.uuid-textarea');
          if (textarea) {
            
            let currentMetadata;
            try {
              currentMetadata = JSON.parse(textarea.value);
            } catch {
              currentMetadata = {};
            }
         
            const merged = mergeUuidAndModifiedToMetadata(currentMetadata, tree);
            textarea.value = JSON.stringify(merged, null, 2);
          }
        }
        resolve(true);
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(poll, intervalMs);
      } else {
        resolve(false); 
      }
    };
    poll();
  });
}


//finds uuids for paths in Friestore tree
function findUuidForPath(fsNode, pathParts, level = 0) {
  if (!fsNode || !pathParts || pathParts.length === 0) return "";


  for (const uuid in fsNode) {
    const node = fsNode[uuid];
    if (typeof node === "string") {
    
      if (node === pathParts[0] && pathParts.length === 1) {
        return uuid;
      }
    } else if (typeof node === "object" && node._name) {
    
      if (node._name === pathParts[0]) {
     
        if (pathParts.length > 1) {
          const found = findUuidForPath(node, pathParts.slice(1), level + 1);
          if (found) return found;
        }
      }
    }
  }
  return "";
}

//FUNCTION WHICH ELABORATES DATA FROM FRIESTORE TREE BEFORE SENDING IT TO THE CLIENT AT THE CREATION
function mergeUuidAndModifiedToMetadata(metadata, firestoreTree) {
  function traverse(metaNode, fsNodeRoot, parentPath = "") {
    const result = Array.isArray(metaNode) ? [] : {};
    for (const key in metaNode) {
      const value = metaNode[key];
      if (
        typeof value === "object" &&
        value !== null &&
        "content" in value &&
        "last-modifier" in value
      ) {
      
        const path = parentPath ? `${parentPath}/${key}` : key;
        const uuid = findUuidForPath(firestoreTree, path.split("/"));
        result[key] = {
          ...value,
          uuid: uuid || "",
          modified: false
        };
      } else if (typeof value === "object" && value !== null) {
        const path = parentPath ? `${parentPath}/${key}` : key;
        result[key] = traverse(value, fsNodeRoot, path);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return traverse(metadata, firestoreTree, "");
}




