import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { test } from 'vitest'
import { openBusinessPreviewNetwork } from '../scripts/business-preview-network.mjs'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const chromeAvailable = await access(chromePath).then(() => true, () => false)

test.skipIf(!chromeAvailable)('captures the actual browser Mock response body and selection headers', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/mock/test.json') {
      response.writeHead(200, { 'Content-Type': 'application/json',
        'x-local-mock-profile': 'profile-one', 'x-local-mock-scenario': 'scenario-one' })
      response.end(JSON.stringify({ data: { value: 'real-browser-response' } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><button style="position:fixed;left:0;top:0;width:100px;height:60px" onclick="document.body.dataset.tapped=String(event.isTrusted)">Open</button><script>fetch("/mock/test.json").then(response => response.json())</script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let capture
  try {
    capture = await openBusinessPreviewNetwork({
      chromePath, requestPath: '/mock/test.json',
      mobileViewport: { width: 402, height: 874, deviceScaleFactor: 3 },
      userAgent: 'DSH-Mobile-Preview-Test'
    })
    await capture.navigate(`http://127.0.0.1:${server.address().port}/`)
    const deadline = Date.now() + 10_000
    while (!capture.responses.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(await capture.evaluate('window.innerWidth'), 402)
    assert.equal(await capture.evaluate('navigator.userAgent'), 'DSH-Mobile-Preview-Test')
    assert.equal(capture.responses.length, 1)
    assert.equal(capture.responses[0].profileId, 'profile-one')
    assert.equal(capture.responses[0].scenarioId, 'scenario-one')
    assert.deepEqual(capture.responses[0].body, { data: { value: 'real-browser-response' } })
    await assert.rejects(capture.tap(-1, NaN), /Invalid tap coordinates/)
    await capture.tap(50, 30)
    const tapDeadline = Date.now() + 3000
    while (await capture.evaluate('document.body.dataset.tapped') !== 'true' && Date.now() < tapDeadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(await capture.evaluate('document.body.dataset.tapped'), 'true')
  } finally {
    await capture?.close()
    await new Promise(resolve => server.close(resolve))
  }
}, 20000)
