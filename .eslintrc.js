module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // The global jest object is only injected by the test runner.
      files: ['jest.setup.js'],
      env: { jest: true },
    },
  ],
};
