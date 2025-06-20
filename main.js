import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, remove  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getFirestore, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getcredentials } from "/credentials.js";

// Firebase configuration
const firebaseConfig= getcredentials();
console.log(firebaseConfig)

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);



// Helper to update current authors
function updateCurrentAuthors(currentAuthorsArray, author) {
  if (!currentAuthorsArray.includes(author)) {
    currentAuthorsArray.push(author);
  }
  return currentAuthorsArray;
}


// Helper to retrieve fields from RT firebase
async function fetch(database, projectPath, field) {
  const snapshot = await get(ref(database, projectPath));
  if (!snapshot.exists()) return null;

  const data = snapshot.val();
  const fieldData = data[field];

  if (!fieldData) return null;

  if (typeof fieldData === 'object' && !Array.isArray(fieldData)) {
    return Object.values(fieldData);
  }

  return fieldData;
}



// Open project (create if it doesn't exist with current author or add another current author)
async function open_project(database, id, author, projectData) {
  const projectPath = `active_projects/${id}`;
  const snapshot = await get(ref(database, projectPath));

  if (snapshot.exists()) {
    const data = snapshot.val();
    let currentAuthors = data["current-authors"] || [];

    if (!Array.isArray(currentAuthors)) {
      currentAuthors = Object.values(currentAuthors);
    }

    currentAuthors = updateCurrentAuthors(currentAuthors, author);

    await update(ref(database, projectPath), { "current-authors": currentAuthors });
    alert("Another author is activating the project...");
    console.log("Project already existed. Updated current-authors:", currentAuthors);
  } else {
    await set(ref(database, projectPath), {
      ...projectData,
      "current-authors": [author]
    });
    alert("Project activation");
    console.log("Project activated on RT");
  }
}


// update project
async function update_project(id, newTree) {
  const treePath = `active_projects/${id}/tree`;

  //retrieves old tree from realtime snapshot
  const snapshot = await get(ref(database, treePath));
  const oldTree = snapshot.exists() ? snapshot.val() : {};

  //builds id map for both the old and the new tree tree
  const oldIdMap = {};
  const newIdMap = {};
  buildIdMap(oldTree, '', oldIdMap);
  buildIdMap(newTree, '', newIdMap);

 
  for (const newId in newIdMap) {
    //if ids are the same but in different paths
    //renomination or movements
    if (newId in oldIdMap && oldIdMap[newId] !== newIdMap[newId]) {
      const oldPath = `${treePath}/${oldIdMap[newId]}`;
      console.log(`Renomination or movement detected`);
      await deleteFromDatabase(oldPath);
      console.log(`id=${newId}: old path ${oldIdMap[newId]} was removed`);
    }
  }

  // sets all the tree again, so also adds new elements, new renominated or moved paths
  await updateDatabase(treePath, newTree);
  console.log('Tree updated successfully');

  //deletes ids that are no longer present in the new tree
  for (const oldId in oldIdMap) {
    if (!(oldId in newIdMap)) {
      const deletePath = `${treePath}/${oldIdMap[oldId]}`;
      await deleteFromDatabase(deletePath);
      console.log(`Deleted id=${oldId} percorso=${oldIdMap[oldId]}`);
    }
  }

  console.log('Update completed');
}




function buildIdMap(tree, basePath = '', idMap = {}) {
  for (const key in tree) {
    const node = tree[key];
    const currentPath = basePath ? `${basePath}/${key}` : key;

    if (typeof node === 'object' && node !== null) {
      const id = node.id_file || node.id_folder;
      if (id) idMap[id] = currentPath;

      buildIdMap(node, currentPath, idMap);
    }
  }
  return idMap;
}



async function updateDatabase(path, data) {
  console.log(`[Firebase SET] ${path}`, data);
  await set(ref(database, path), data);
}

async function deleteFromDatabase(path) {
  console.log(`[Firebase DELETE] ${path}`);
  await remove(ref(database, path));
}


// Close project (remove current author or if no current authors are left, remove project ONLY from real time db)
async function close_project(database, id, author) {
  const projectPath = `active_projects/${id}`;
  let currentAuthors = await fetch(database, projectPath, "current-authors");

  if (!Array.isArray(currentAuthors)) {
    currentAuthors = currentAuthors ? Object.values(currentAuthors) : [];
  }

  currentAuthors = currentAuthors.filter(a => a !== author);

  if (currentAuthors.length === 0) {
    await set(ref(database, projectPath), null); // Delete the project from realtime
    console.log(`Project ${id} deleted from database.`);
  } else {
    await update(ref(database, projectPath), {
      "current-authors": currentAuthors
    });
    console.log(`Removed author ${author} from current-authors.`);
  }
}
  

// DELETE project PERMANENTLY (also from firestore and github)
async function delete_project(database, id) {
  const projectPath = `active_projects/${id}`;
  await set(ref(database, projectPath), null);
  console.log(`Project ${id} deleted from Realtime database.`);
  
  const firestore = getFirestore();
  const docRef = doc(firestore, "projects", id);
  await deleteDoc(docRef);
  console.log(`Project ${id} deleted from Firestore.`);
  
}



//buttons
window.addEventListener("DOMContentLoaded", () => {
  const openBtn = document.getElementById("open");
  const closeBtn = document.getElementById("close");
  const updateBtn = document.getElementById("update");
  const deleteBtn = document.getElementById("delete"); // FIXED: id corretto

  if (openBtn) {
    openBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const author = button.getAttribute("data-author");
      const id = button.getAttribute("data-project-id");
      const title = button.getAttribute("data-title");
      const data_tree = button.getAttribute("data-tree");
      console.log("data tree: ", data_tree);
      const tree = JSON.parse(data_tree);
      console.log("parsed tree: ", tree);

      const co_authors = JSON.parse(button.getAttribute("data-co-authors"));
     

      const projectData = { id, title, tree, "co-authors": co_authors };

      console.log("projectData:", projectData);
      await open_project(database, id, author, projectData);
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const author = button.getAttribute("data-author");
      const id = button.getAttribute("data-project-id");

      alert(`Closing project for ${author}...`);
      await close_project(database, id, author);

    });
  }

  if (updateBtn) {
    updateBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const id = button.getAttribute("data-project-id");
      const data_tree = button.getAttribute("data-tree");
      console.log("data tree: ", data_tree);
      const tree = JSON.parse(data_tree);
      console.log("parsed tree: ", tree);
  

      console.log("Tree:", tree);
      alert(`Updating project...`);
      await update_project(id, tree);

    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const id = button.getAttribute("data-project-id");
      const author = button.getAttribute("data-author");

      alert(`Deleting project ${id}...`);
      await delete_project(database, id, author);
    });
  }
});





