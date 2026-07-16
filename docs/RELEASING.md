# Releasing jigtor

A release is cut by pushing a `v*` tag. `release.yml` then builds the web zip +
desktop binaries (macOS ×2, Linux, Windows) and attaches them to a GitHub Release.

```bash
# bump package.json + src-tauri/tauri.conf.json to the new version first, commit,
git tag -a v0.3.3 -m "jigtor 0.3.3"
git push origin main v0.3.3
```

## macOS code signing + notarization

The desktop build reads six repo secrets. When they are present, `tauri-action`
signs with the Developer ID cert and notarizes with Apple; when absent it produces
an **unsigned** build (no failure), which macOS blocks as "damaged" on download.

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the exported `Developer ID Application` cert (`.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an **app-specific** password (appleid.apple.com → Sign-In and Security) |
| `APPLE_TEAM_ID` | your 10-char Team ID |

### One-time setup (run locally, you hold the cert)

```bash
# 1. Confirm the signing identity string (needs "Developer ID Application")
security find-identity -v -p codesigning

# 2. Export that cert from Keychain Access as Certificates.p12 (set a password),
#    then base64 it:
base64 -i Certificates.p12 | pbcopy   # -> paste into APPLE_CERTIFICATE

# 3. Store all six secrets (repo must be the default; -R sets it explicitly)
gh secret set APPLE_CERTIFICATE           -R elzup/jigtor   # paste the base64
gh secret set APPLE_CERTIFICATE_PASSWORD  -R elzup/jigtor
gh secret set APPLE_SIGNING_IDENTITY      -R elzup/jigtor   # the full identity string
gh secret set APPLE_ID                    -R elzup/jigtor
gh secret set APPLE_PASSWORD              -R elzup/jigtor   # app-specific password
gh secret set APPLE_TEAM_ID               -R elzup/jigtor
```

Once set, the **next** tagged release produces a signed + notarized macOS build
that opens without the Gatekeeper warning. No workflow change is needed.

## Unsigned build workaround (until secrets are configured)

macOS quarantines unsigned downloads. To open one:

```bash
xattr -dr com.apple.quarantine /Applications/jigtor.app
```

## Windows

Windows binaries (`.msi`, `-setup.exe`) are unsigned — SmartScreen may warn on
first run (More info → Run anyway). Authenticode signing needs a separate paid
code-signing certificate and is not set up.
