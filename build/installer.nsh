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

; ── The app's data folder ────────────────────────────────────────────────────
; An installed build keeps its data (the Chromium profile, whose localStorage
; holds the session of unsaved designs, and settings.json) in $APPDATA\TFStudio,
; the folder resolveUserDataDir in src/main/userDataDir.js names. Releases up
; to 1.8.3 kept it in AppData inside the install folder, and an update runs the
; previous version's uninstaller, which deletes that folder. The installer
; therefore copies the old install's AppData across once the running app is
; closed and before the old uninstaller runs.
;
; electron-builder inserts customCheckAppRunning in place of its own check, so
; the stock check is inserted first. That check needs the process-info library
; and $pid, which the template declares only when no custom check is defined.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    Var /GLOBAL oldInstallDir
    ReadRegStr $oldInstallDir SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $oldInstallDir == ""
      StrCpy $oldInstallDir $INSTDIR
    ${endIf}
    !insertmacro keepInstallData "$oldInstallDir" "$APPDATA\TFStudio"
  !endif
!macroend

; Copy OLD_DIR\AppData into DATA_DIR when the old install has a profile. A
; profile already in DATA_DIR, left there by a newer build before a downgrade,
; is moved aside to DATA_DIR.old rather than merged: the two LevelDB folders
; inside cannot be mixed. If anything fails the install stops here, before the
; old uninstaller removes anything.
!macro keepInstallData OLD_DIR DATA_DIR
  ${if} ${FileExists} "${OLD_DIR}\AppData\Local Storage\*.*"
    ClearErrors
    ${if} ${FileExists} "${DATA_DIR}\Local Storage\*.*"
      ${if} ${FileExists} "${DATA_DIR}.old\*.*"
        RMDir /r "${DATA_DIR}.old"
      ${endIf}
      Rename "${DATA_DIR}" "${DATA_DIR}.old"
    ${endIf}
    ${ifNot} ${Errors}
      CreateDirectory "${DATA_DIR}"
      CopyFiles /SILENT "${OLD_DIR}\AppData\*.*" "${DATA_DIR}"
    ${endIf}
    ${if} ${Errors}
      !insertmacro keepDataFailedText $R9
      MessageBox MB_OK|MB_ICONSTOP "$R9" /SD IDOK
      Abort
    ${endIf}
  ${endIf}
!macroend

; In the app's four languages, English for every other language the installer
; runs in. Picked at run time rather than with LangString, which leaves the
; text empty in every language it is not given for.
!macro keepDataFailedText OUT
  ${if} $LANGUAGE == 1049
    StrCpy ${OUT} "Обновление остановлено, ничего не удалено: TFStudio не удалось скопировать настройки и несохранённые проекты из старой папки установки. Проверьте, что на диске есть свободное место, и запустите установщик снова."
  ${elseIf} $LANGUAGE == 2052
    StrCpy ${OUT} "更新已停止，未删除任何内容：TFStudio 无法从旧的安装文件夹中复制其设置和未保存的设计。请确认磁盘有可用空间，然后重新运行安装程序。"
  ${elseIf} $LANGUAGE == 1040
    StrCpy ${OUT} "L'aggiornamento è stato interrotto e non è stato rimosso nulla: TFStudio non è riuscito a copiare le impostazioni e i design non salvati dalla vecchia cartella di installazione. Verifica che il disco abbia spazio libero, poi avvia di nuovo il programma di installazione."
  ${else}
    StrCpy ${OUT} "The update was stopped and nothing was removed: TFStudio could not copy its settings and unsaved designs out of the old installation folder. Check that the disk has free space, then run the installer again."
  ${endIf}
!macroend
