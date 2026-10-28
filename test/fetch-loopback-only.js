// Prevent local regression tests from uploading anything to a real service.
const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        throw new Error('Local tests block HTTP requests outside loopback')
    }
    return originalFetch(input, init)
}
