// Tiny Chrome DevTools Protocol driver for testing the running app.
// Usage: node scripts/cdp.mjs <port> eval "<js>"  |  shot <file.png>
const [port, cmd, arg] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r.result, null, 1))
} else if (cmd === 'offline') {
  await send('Network.enable')
  const off = arg === 'on'
  await send('Network.emulateNetworkConditions', { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  if (!off) await send('Network.disable')
  console.log('offline', off)
  await new Promise((r) => setTimeout(r, 300))
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const fs = await import('fs')
  fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'))
  console.log('saved', arg)
}
ws.close()
process.exit(0)
