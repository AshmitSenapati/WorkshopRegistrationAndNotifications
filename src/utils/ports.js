import net from 'net';

/**
 * Checks whether a TCP port is currently available on the specified host.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
export async function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, host);
  });
}

/**
 * Finds the first available TCP port starting from preferredPort.
 * @param {number} preferredPort
 * @param {string} host
 * @param {number} maxAttempts
 * @returns {Promise<number>}
 */
export async function findAvailablePort(preferredPort, host = '127.0.0.1', maxAttempts = 100) {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidatePort = preferredPort + offset;
    const available = await isPortAvailable(candidatePort, host);
    if (available) {
      return candidatePort;
    }
  }
  throw new Error(`Unable to find an available port starting from ${preferredPort} (tested ${maxAttempts} ports)`);
}
