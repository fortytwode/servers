import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getValidRootDirectories } from '../roots-utils.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'node:url';
import type { Root } from '@modelcontextprotocol/sdk/types.js';

describe('getValidRootDirectories', () => {
  let testDir1: string;
  let testDir2: string;
  let testDir3: string;
  let testFile: string;

  beforeEach(() => {
    // Create test directories
    testDir1 = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-roots-test1-')));
    testDir2 = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-roots-test2-')));
    testDir3 = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-roots-test3-')));

    // Create a test file (not a directory)
    testFile = join(testDir1, 'test-file.txt');
    writeFileSync(testFile, 'test content');
  });

  afterEach(() => {
    // Cleanup
    rmSync(testDir1, { recursive: true, force: true });
    rmSync(testDir2, { recursive: true, force: true });
    rmSync(testDir3, { recursive: true, force: true });
  });

  describe('valid directory processing', () => {
    it('should process all URI formats and edge cases', async () => {
      const roots = [
        { uri: `file://${testDir1}`, name: 'File URI' },
        { uri: testDir2, name: 'Plain path' },
        { uri: testDir3 } // Plain path without name property
      ];

      const result = await getValidRootDirectories(roots);

      expect(result).toContain(testDir1);
      expect(result).toContain(testDir2);
      expect(result).toContain(testDir3);
      expect(result).toHaveLength(3);
    });

    it('should decode a standard local file URI', async () => {
      const directory = join(testDir1, 'root café #100%');
      mkdirSync(directory);

      const uri = pathToFileURL(directory).href;
      const localHostUri = uri.replace('file:///', 'file://localhost/');

      await expect(getValidRootDirectories([{ uri }, { uri: localHostUri }]))
        .resolves.toEqual([directory, directory]);
    });

    it('should not select a different directory for a file URI with a query or fragment', async () => {
      const directory = join(testDir1, 'plain#root');
      mkdirSync(directory);
      const uri = pathToFileURL(testDir1).href;

      await expect(getValidRootDirectories([
        { uri: `${uri}?raw` }, { uri: `${uri}#raw` }, { uri: directory },
      ])).resolves.toEqual([directory]);
    });

    it('should retain home directory aliases', async () => {
      const home = realpathSync(homedir());
      await expect(getValidRootDirectories([{ uri: '~' }, { uri: 'file://~' }]))
        .resolves.toEqual([home, home]);
    });

    it('should normalize complex paths', async () => {
      const subDir = join(testDir1, 'subdir');
      mkdirSync(subDir);
      
      const roots = [
        { uri: `file://${testDir1}/./subdir/../subdir`, name: 'Complex Path' }
      ];

      const result = await getValidRootDirectories(roots);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(subDir);
    });
  });

  describe('error handling', () => {

    it('should handle various error types', async () => {
      const nonExistentDir = join(tmpdir(), 'non-existent-directory-12345');
      const invalidPath = '\0invalid\0path'; // Null bytes cause different error types
      const roots = [
        { uri: `file://${testDir1}`, name: 'Valid Dir' },
        { uri: `file://${nonExistentDir}`, name: 'Non-existent Dir' },
        { uri: `file://${testFile}`, name: 'File Not Dir' },
        { uri: `file://${invalidPath}`, name: 'Invalid Path' }
      ];

      const result = await getValidRootDirectories(roots);

      expect(result).toContain(testDir1);
      expect(result).not.toContain(nonExistentDir);
      expect(result).not.toContain(testFile);
      expect(result).not.toContain(invalidPath);
      expect(result).toHaveLength(1);
    });
  });
});