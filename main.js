import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, remove  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getFirestore, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getcredentials } from "/credentials.js";

// Firebase configuration
const firebaseConfig= getcredentials();
console.log(firebaseConfig)

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

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

// Helper to update current authors
function updateCurrentAuthors(currentAuthorsArray, author) {
  if (!currentAuthorsArray.includes(author)) {
    currentAuthorsArray.push(author);
  }
  return currentAuthorsArray;
}


// BUILDING THE TREE FROM METADATA
function sanitizeKey(key) {
  if (typeof key !== 'string') {
    console.warn('sanitizeKey: valore non valido');
    console.log('Tipo:', typeof key);
    console.log('Contenuto:', key);

    if (key === null) {
      console.log('È null');
    } else if (Array.isArray(key)) {
      console.log('È un array');
    } else if (typeof key === 'object') {
      console.log('È un oggetto');
    }

    return '';
  }

  return key.replace(/[.#$[\]/]/g, '_');
}





// Open project (create or update)
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



async function moveInDatabase(fromPath, toPath) {
  const data = await getDataFromDatabase(fromPath);
  if (data !== null) {
    await updateDatabase(toPath, data);
    await deleteFromDatabase(fromPath);
  } else {
    console.warn(`moveInDatabase: path sorgente "${fromPath}" non esiste`);
  }
}






async function update_project(id, newTree) {
  const treePath = `active_projects/${id}/tree`;

  // 1) Leggi albero precedente
  const snapshot = await get(ref(database, treePath));
  const oldTree = snapshot.exists() ? snapshot.val() : {};

  // 2) Mappa id -> percorso
  const oldIdMap = {};
  const newIdMap = {};
  buildIdMap(oldTree, '', oldIdMap);
  buildIdMap(newTree, '', newIdMap);

  // 3) Gestisci rinomina/spostamento PRIMA di aggiornare
  for (const newId in newIdMap) {
    if (newId in oldIdMap && oldIdMap[newId] !== newIdMap[newId]) {
      const oldPath = `${treePath}/${oldIdMap[newId]}`;
      await deleteFromDatabase(oldPath);
      console.log(`Nodo rinominato/spostato id=${newId}: rimosso vecchio percorso ${oldIdMap[newId]}`);
    }
  }

  // 4) Aggiorna l’intero albero
  await updateDatabase(treePath, newTree);
  console.log('Aggiornamento albero eseguito');

  // 5) Elimina i nodi obsoleti (dopo aver scritto quelli nuovi)
  for (const oldId in oldIdMap) {
    if (!(oldId in newIdMap)) {
      const deletePath = `${treePath}/${oldIdMap[oldId]}`;
      await deleteFromDatabase(deletePath);
      console.log(`Rimosso nodo obsoleto id=${oldId} percorso=${oldIdMap[oldId]}`);
    }
  }

  console.log('Aggiornamento progetto completato');
}



// Funzione per costruire mappa id_file/id_folder -> percorso (ricorsiva)
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


// Funzioni helper per interazione con Firebase (le tue esistenti)
async function updateDatabase(path, data) {
  console.log(`[Firebase SET] ${path}`, data);
  await set(ref(database, path), data);
}

async function deleteFromDatabase(path) {
  console.log(`[Firebase DELETE] ${path}`);
  await remove(ref(database, path));
}



  

// DELETE project PERMANENTLY
async function delete_project(database, id) {
  const projectPath = `active_projects/${id}`;
  await set(ref(database, projectPath), null);
  console.log(`Project ${id} deleted from Realtime database.`);

  
  const firestore = getFirestore();
  const docRef = doc(firestore, "projects", id);
  await deleteDoc(docRef);
  console.log(`Project ${id} deleted from Firestore.`);
  
}


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
      const data_tree = sanitizeKey(button.getAttribute("data-tree"));
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
      const data_tree = button.getAttribute("data-tree").replace(/\./g, "_");
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






//delete