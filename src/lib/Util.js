'use strict';

const childProcess = require('child_process');

module.exports = class Util {

  static isValidIPv4(str) {
    const blocks = str.split('.');
    if (blocks.length !== 4) return false;

    for (let value of blocks) {
      value = parseInt(value, 10);
      if (Number.isNaN(value)) return false;
      if (value < 0 || value > 255) return false;
    }

    return true;
  }

  static promisify(fn) {
    // eslint-disable-next-line func-names
    return function(req, res) {
      Promise.resolve().then(async () => fn(req, res))
        .then((result) => {
          if (res.headersSent) return;

          if (typeof result === 'undefined') {
            return res
              .status(204)
              .end();
          }

          return res
            .status(200)
            .json(result);
        })
        .catch((error) => {
          if (typeof error === 'string') {
            error = new Error(error);
          }

          // eslint-disable-next-line no-console
          console.error(error);

          return res
            .status(error.statusCode || 500)
            .json({
              error: error.message || error.toString(),
              stack: error.stack,
            });
        });
    };
  }

  static async exec(cmd, {
    log = true,
  } = {}) {
    if (typeof log === 'string') {
      // eslint-disable-next-line no-console
      console.log(`$ ${log}`);
    } else if (log === true) {
      // eslint-disable-next-line no-console
      console.log(`$ ${cmd}`);
    }

    if (process.env.WG_MANAGEMENT_ONLY === 'true') {
      const trimmedCmd = cmd.trim();
      if (trimmedCmd === 'wg genkey') {
        const crypto = require('crypto');
        return crypto.randomBytes(32).toString('base64');
      }
      if (trimmedCmd === 'wg genpsk') {
        const crypto = require('crypto');
        return crypto.randomBytes(32).toString('base64');
      }
      if (trimmedCmd.startsWith('echo ') && trimmedCmd.includes('wg pubkey')) {
        const match = trimmedCmd.match(/echo\s+([^\s|]+)/);
        if (match) {
          const privateKeyBase64 = match[1];
          try {
            const crypto = require('crypto');
            const rawPrivate = Buffer.from(privateKeyBase64, 'base64');
            const pkcs8 = Buffer.concat([
              Buffer.from([
                0x30, 0x2e,
                0x02, 0x01, 0x00,
                0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e,
                0x04, 0x22,
                0x04, 0x20
              ]),
              rawPrivate
            ]);
            const key = crypto.createPrivateKey({
              key: pkcs8,
              format: 'der',
              type: 'pkcs8'
            });
            const pubKeyObject = crypto.createPublicKey(key);
            const spki = pubKeyObject.export({ format: 'der', type: 'spki' });
            const rawPublic = spki.slice(spki.length - 32);
            return rawPublic.toString('base64');
          } catch (e) {
            console.error('Error deriving public key:', e);
            const crypto = require('crypto');
            return crypto.randomBytes(32).toString('base64');
          }
        }
      }
      if (trimmedCmd.startsWith('wg show') && trimmedCmd.includes('dump')) {
        return '';
      }
      return '';
    }

    if (process.platform !== 'linux') {
      return '';
    }

    return new Promise((resolve, reject) => {
      childProcess.exec(cmd, {
        shell: 'bash',
      }, (err, stdout) => {
        if (err) return reject(err);
        return resolve(String(stdout).trim());
      });
    });
  }

  static async execFile(file, args = [], {
    log = false,
  } = {}) {
    if (log === true) {
      // eslint-disable-next-line no-console
      console.log(`$ ${file} ${args.join(' ')}`);
    } else if (typeof log === 'string') {
      // eslint-disable-next-line no-console
      console.log(`$ ${log}`);
    }

    if (process.platform !== 'linux') {
      return '';
    }

    return new Promise((resolve, reject) => {
      childProcess.execFile(file, args, (err, stdout) => {
        if (err) return reject(err);
        return resolve(String(stdout).trim());
      });
    });
  }

};
