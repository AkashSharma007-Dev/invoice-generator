const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState:       ()                    => ipcRenderer.invoke('store:get'),
  saveSettings:   (s)                   => ipcRenderer.invoke('store:saveSettings', s),
  peekNo:         (branch, year)        => ipcRenderer.invoke('store:peekNo', branch, year),
  commitNo:       (branch, year, n)     => ipcRenderer.invoke('store:commitNo', branch, year, n),
  setCounter:     (key, value)          => ipcRenderer.invoke('store:setCounter', key, value),
  upsertClient:   (c)                   => ipcRenderer.invoke('store:upsertClient', c),
  deleteClient:   (name)                => ipcRenderer.invoke('store:deleteClient', name),
  saveInvoice:    (inv)                 => ipcRenderer.invoke('store:saveInvoice', inv),
  deleteInvoice:  (id)                  => ipcRenderer.invoke('store:deleteInvoice', id),
  exportPdf:      (payload)             => ipcRenderer.invoke('export:pdf', payload),
  exportXlsx:     (payload)             => ipcRenderer.invoke('export:xlsx', payload),
  showItem:       (filePath)            => ipcRenderer.invoke('shell:showItem', filePath),
  version:        ()                    => ipcRenderer.invoke('app:version'),
  importPick:     ()                    => ipcRenderer.invoke('import:pick'),
  importReread:   (payload)             => ipcRenderer.invoke('import:reread', payload),
  saveStatement:  (st)                  => ipcRenderer.invoke('store:saveStatement', st),
  deleteStatement:(id)                  => ipcRenderer.invoke('store:deleteStatement', id),
  clientInvoices: (name, from, to)      => ipcRenderer.invoke('store:clientInvoices', name, from, to),
  exportStmtXlsx: (payload)             => ipcRenderer.invoke('export:statementXlsx', payload),
  stmtImportPick: ()                    => ipcRenderer.invoke('stmtImport:pick'),
  stmtImportReread:(payload)            => ipcRenderer.invoke('stmtImport:reread', payload),
  checkUpdates:   ()                    => ipcRenderer.invoke('update:check'),
  installUpdate:  ()                    => ipcRenderer.invoke('update:install'),
  onUpdate:       (cb)                  => ipcRenderer.on('update:status', (e, s) => cb(s))
});
