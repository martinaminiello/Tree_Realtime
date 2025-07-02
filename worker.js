self.onmessage = (e) => {
  try {
    const { action, id, title, metadata, co_authors } = e.data;

    if (action === 'open') {
    
      const lastModified = generateLastModifiedMap(metadata);
      const cacheArray = generateCacheArray(metadata, lastModified);
      const projectData = { id, title, "last-modified": lastModified, "co-authors": co_authors };

      self.postMessage({
        action,
        processedData: {
          id,
          projectData,
          cacheArray
        }
      });
    }
    
     if (action === 'update') {
  
    self.postMessage({
    action,
    processedData: {
      id,
      metadata,
      title,
      co_authors
    }
  });
}


     if (action === 'delete') {

      self.postMessage({
        action,
        processedData: {
          id
        }
      });
    }


    

  } catch (error) {
    self.postMessage({ action: e.data?.action, error: error.message || String(error) });
  }
};



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
            timestamp: Date.now(), 
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

function generateLastModifiedMap(tree, basePath = '') {
  const result = {};
  for (const key in tree) {
    const value = tree[key];
    const currentPath = basePath ? `${basePath}/${key}` : key;
    if (typeof value === 'object' && value !== null && 'content' in value && 'last-modifier' in value) {
      result[currentPath] = {
        _name: key,
        "last-modifier": value["last-modifier"],
        timestamp: Date.now(),
        uuid_cache: value.uuid_cache ||  crypto.randomUUID()
      };
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, generateLastModifiedMap(value, currentPath));
    }
  }
  return result;
}

