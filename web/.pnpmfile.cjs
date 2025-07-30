// Empty pnpmfile - no hooks needed
module.exports = {
  hooks: {
    readPackage(pkg) {
      return pkg;
    }
  }
};