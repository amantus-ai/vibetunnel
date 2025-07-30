module.exports = {
  hooks: {
    readPackage(pkg) {
      // Allow postinstall scripts for @tailwindcss/oxide
      if (pkg.name === '@tailwindcss/oxide') {
        pkg.trustedDependencies = ['@tailwindcss/oxide'];
      }
      return pkg;
    }
  }
};