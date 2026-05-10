import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}
