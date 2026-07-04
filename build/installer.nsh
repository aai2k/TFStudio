; Custom NSIS script to ensure shortcuts use the correct icon.
; Included during the NSIS installer build (see package.json build.nsis.include).

!macro customInstall
  ; Create shortcuts with explicit icon from the executable
  ${ifNot} ${isUpdated}
    ; Desktop shortcut with icon from exe
    CreateShortCut "$DESKTOP\TFStudio.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL

    ; Start Menu shortcut with icon from exe
    CreateDirectory "$SMPROGRAMS\TFStudio"
    CreateShortCut "$SMPROGRAMS\TFStudio\TFStudio.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL
  ${endIf}
!macroend

!macro customUnInstall
  ; Clean up the shortcuts created above.
  Delete "$DESKTOP\TFStudio.lnk"
  Delete "$SMPROGRAMS\TFStudio\TFStudio.lnk"
  RMDir  "$SMPROGRAMS\TFStudio"
!macroend
