// Keyboard commands → the player tab. Opens a pinned player tab when none is running.
const PLAYER = chrome.runtime.getURL('player.html')

async function playerTab() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [PLAYER] })
  return ctx[0]?.tabId ?? null
}

async function openPlayer() {
  const id = await playerTab()
  if (id != null) {
    const tab = await chrome.tabs.update(id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url: PLAYER, pinned: true, active: true })
}

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'openPlayer') return openPlayer()
  if ((await playerTab()) == null) return openPlayer()
  try { await chrome.runtime.sendMessage({ to: 'player', cmd }) } catch { /* player still loading */ }
})

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.to !== 'background') return
  if (msg.type === 'openPlayer') openPlayer().then(() => reply(true))
  return true
})
