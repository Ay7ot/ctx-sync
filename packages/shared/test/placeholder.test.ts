import { VERSION, DEFAULT_SAFE_LIST, STATE_FILES, CONFIG_DIR, SYNC_DIR } from '../src/index.js';

describe('@ctx-sync/shared', () => {
  it('should export VERSION', () => {
    expect(VERSION).toBe('1.0.0');
  });

  it('should export DEFAULT_SAFE_LIST with known keys', () => {
    expect(DEFAULT_SAFE_LIST).toContain('NODE_ENV');
    expect(DEFAULT_SAFE_LIST).toContain('PORT');
    expect(DEFAULT_SAFE_LIST).toContain('DEBUG');
    expect(DEFAULT_SAFE_LIST.length).toBeGreaterThan(0);
  });

  it('should export STATE_FILES constants', () => {
    expect(STATE_FILES.STATE).toBe('state.age');
    expect(STATE_FILES.ENV_VARS).toBe('env-vars.age');
    expect(STATE_FILES.MANIFEST).toBe('manifest.json');
  });

  it('should export directory constants', () => {
    expect(CONFIG_DIR).toBe('ctx-sync');
    expect(SYNC_DIR).toBe('.context-sync');
  });
});
