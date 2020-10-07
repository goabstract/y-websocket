#!/usr/bin/env node

/**
 * @type {any}
 */
const Y = require("yjs");
const WebSocket = require('ws')
const http = require('http')
const wss = new WebSocket.Server({ noServer: true })
const { setPersistence, setupWSConnection } = require('./utils.js')
const PGPool = require("pg").Pool;
const decoding = require('lib0/dist/decoding.cjs')

const port = process.env.PORT || 1234;

const db = new PGPool({
  ssl: {
    rejectUnauthorized: false,
  },
  connectionString:
    "postgres://trkvrqhplsqrxu:ecef6e69efa43f65efc11f139d7654d57f3405c3f2fe41f65ec387dd475ec377@ec2-23-22-156-110.compute-1.amazonaws.com:5432/d3970l6l754e9c",
});

function yDocToProsemirror(ydoc) {
  const items = ydoc.getXmlFragment("prosemirror").toArray();

  function serialize(item) {
    let response;

    // TODO: Must be a better way to detect text nodes than this
    if (!item.nodeName) {
      response = response = {
        type: "text",
        text: item.toString(),
      }
    } else {
      response = {
        type: item.nodeName
      }

      const attrs = item.getAttributes();
      if (Object.keys(attrs).length) {
        response.attrs = attrs;
      }

      const children = item.toArray();
      if (children.length) {
        response.content = children.map(serialize);
      }
    }

    return response;
  }

  return items.map(serialize)
}

setPersistence({
  bindState: async (id, ydoc) => {
    // Here you listen to granular document updates and store them in the database
    // You don't have to do this, but it ensures that you don't lose content when the server crashes
    // See https://github.com/yjs/yjs#Document-Updates for documentation on how to encode 
    // document updates
    ydoc.get('prosemirror', Y.XmlFragment)

    const res = await db.query("SELECT data from documents WHERE id = $1 LIMIT 1", [id]);

    const data = res.rows[0] ? res.rows[0].data : undefined;
    console.log("Retrieved from db…");
    console.log({ data })

    if (data) {
      console.log("Applying db data to doc")
      Y.applyUpdate(ydoc, data);
      console.log(JSON.stringify(yDocToProsemirror(ydoc), undefined, 2));
    }
  
    ydoc.on('update', (update, origin) => {
      Y.applyUpdate(ydoc, update);

      const state = Y.encodeStateAsUpdate(ydoc);
      console.log("persisting…")
      

      db.query("INSERT INTO documents (id, data) VALUES($2,$1) ON CONFLICT (id) DO UPDATE SET data = $1", [
        state,
        id,
      ]).then(() => {
        console.log("Persisted to db", ydoc.toJSON());
      })
    })
  },
  writeState: async (id, ydoc) => {
    // This is called when all connections to the document are closed.
    // In the future, this method might also be called in intervals or after a
    // certain number of updates.

    // const state = Y.encodeStateAsUpdate(ydoc);

    // await db.query("UPDATE documents SET state = $1 WHERE id = $2", [
    //   Buffer.from(state).toString('base64'),
    //   id,
    // ])
  }
})

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

wss.on('connection', setupWSConnection)

server.on('upgrade', (request, socket, head) => {
  // You may check auth of request here..
  /**
   * @param {any} ws
   */
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(port)

console.log('running on port', port)
