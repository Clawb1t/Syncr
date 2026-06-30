$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Set-Location 'c:\Users\coal1\OneDrive\Documents\Coal\Syncr\launcher'
npm run build 2>&1 | Tee-Object -FilePath 'c:\Users\coal1\OneDrive\Documents\Coal\Syncr\launcher\build-log.txt'
