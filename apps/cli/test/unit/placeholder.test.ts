describe('Placeholder', () => {
  it('should pass a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have a global TEST_DIR defined', () => {
    expect(globalThis.TEST_DIR).toBeDefined();
    expect(typeof globalThis.TEST_DIR).toBe('string');
  });
});
