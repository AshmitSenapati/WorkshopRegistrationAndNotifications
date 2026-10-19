import { describe, it, expect } from 'vitest';
import net from 'net';
import { isPortAvailable, findAvailablePort } from '../src/utils/ports.js';

describe('5. Port Detection & Process Isolation Utility', () => {
  it('detects available and occupied ports reliably', async () => {
    // 1. Find a free port
    const freePort = await findAvailablePort(6100);
    expect(freePort).toBeGreaterThanOrEqual(6100);

    const isInitiallyAvailable = await isPortAvailable(freePort);
    expect(isInitiallyAvailable).toBe(true);

    // 2. Bind a temporary TCP server to that port
    const server = net.createServer();
    await new Promise((resolve) => server.listen(freePort, '127.0.0.1', resolve));

    // 3. Port should now be detected as occupied
    const isOccupied = await isPortAvailable(freePort);
    expect(isOccupied).toBe(false);

    // 4. findAvailablePort should skip the occupied port and return a subsequent one
    const nextPort = await findAvailablePort(freePort);
    expect(nextPort).toBeGreaterThan(freePort);

    // 5. Release port
    await new Promise((resolve) => server.close(resolve));

    // 6. Port should be available again
    const isAvailableAgain = await isPortAvailable(freePort);
    expect(isAvailableAgain).toBe(true);
  });
});
