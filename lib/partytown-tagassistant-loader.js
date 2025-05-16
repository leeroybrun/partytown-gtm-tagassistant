!function(win, doc, config, libPath, isReady, insertBefore) {
  config = win.partytown || {};
  insertBefore = insertBefore || document.currentScript || document.head.firstChild || document.body.firstChild;

  function loadScripts(libPath) {
    const mainScript = document.createElement('script');
    mainScript.src = libPath + 'partytown-tagassistant-main.js';
    mainScript.type = 'text/javascript';
    insertBefore.parentNode.insertBefore(mainScript, insertBefore);

    const workerScript = document.createElement('script');
    workerScript.src = libPath + 'partytown-tagassistant-worker.js';
    workerScript.type = 'text/partytown';
    insertBefore.parentNode.insertBefore(workerScript, insertBefore);

    setTimeout(function() {
      window.dispatchEvent(new CustomEvent("ptupdate"));
    }, 0);
  }

  function ready() {
    if (!isReady) {
      isReady = 1;
      libPath = (config.lib || "/~partytown/");
      if ("/" == libPath[0]) {
        loadScripts(libPath);
      } else {
        console.warn('Partytown config.lib url must start with "/"');
      }
    }
  }

  if ("complete" == doc.readyState) {
    ready();
  } else {
    win.addEventListener("DOMContentLoaded", ready);
    win.addEventListener("load", ready);
  }
}(window, document);