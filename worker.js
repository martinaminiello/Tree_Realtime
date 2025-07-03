self.onmessage = (e) => {
  try {
    const { action, id, title, metadata, co_authors, owners, lastModified, cacheArray } = e.data;

    if (action === 'open') {
    
     
      const projectData = { id, title, "last-modified": lastModified, "co-authors": co_authors, "owners": owners };

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







