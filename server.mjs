import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('docs');
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT || 3000);
createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const file = path === root ? resolve(root, 'index.html') : path;
    const data = await readFile(file);
    res.writeHead(200, {'Content-Type': {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript'}[extname(file)] || 'application/octet-stream'}).end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '0.0.0.0');
