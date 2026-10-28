// Safe to import while react-native-purchases defines its unused browser adapter.
// Access fails loudly if an artifact with the native-only flag enters browser mode.
Object.defineProperty(exports, 'PurchasesCommon', {
    get() { throw new Error('Native-only purchases build entered browser mode; RNPurchases is required.'); },
});
