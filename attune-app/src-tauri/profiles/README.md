# Mac App Store provisioning

Place your **Mac App Store Connect** provisioning profile here:

```
MacAppStore.provisionprofile
```

Download from [developer.apple.com](https://developer.apple.com/account/resources/profiles/list) → Profiles → Mac App Store Connect.

This path is gitignored. CI uses the `MAS_PROVISION_PROFILE_BASE64` secret (see `docs/MAC_APP_STORE.md`).
