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

; ── The app's own files ─────────────────────────────────────────────────────
; build\install-folder-entries.nsh lists the top level of the packed app folder
; and the app's file associations. tools/install-folder-entries.mjs writes it
; when electron-builder packs a Windows build, stamped with the app version, so
; a build that packed nothing (--prepackaged) cannot compile with the list of
; another version.
!include "${BUILD_RESOURCES_DIR}\install-folder-entries.nsh"
!if "${INSTALL_FOLDER_ENTRIES_VERSION}" != "${VERSION}"
  !error "install-folder-entries.nsh lists the files of ${INSTALL_FOLDER_ENTRIES_VERSION}, not of ${VERSION}. It is written when electron-builder packs the app, which a --prepackaged build skips."
!endif

; The first release whose uninstaller removes only the app's own files. The
; uninstallers of the releases before it remove the whole install folder with
; everything in it.
!define FIRST_SAFE_UNINSTALLER "1.8.6"
; The first release that keeps its profile in $APPDATA rather than in AppData
; inside the install folder.
!define FIRST_APPDATA_PROFILE "1.8.4"
!include "WordFunc.nsh"

; ── Before the old uninstaller runs ─────────────────────────────────────────
; An update runs the uninstaller of the old install in its own install mode
; and, when it installs for all users, that of the current user's own install
; too (uninstallOldVersion in the template's installUtil.nsh, called from
; installSection.nsh:52-58). Two steps come first, for both:
;
; - The profile. An installed build keeps its data (the Chromium profile, whose
;   localStorage holds the session of unsaved designs, and settings.json) in
;   the current user's $APPDATA\TFStudio, the folder resolveUserDataDir in
;   src/main/userDataDir.js names. Releases up to 1.8.3 kept it in AppData
;   inside the install folder, which their uninstaller deletes, so that AppData
;   is copied across: the all-users install's first and the current user's own
;   last, so that the user's own is the one in use and the other is kept aside.
;   It is copied only from an install of such a release: an AppData left in a
;   folder a later release was installed into, as when the old app was removed
;   beside a data folder, is older than the profile in use.
; - The data folder. The user can install into any folder, one holding the
;   data folder included: picking Documents installs into Documents\TFStudio,
;   the default data folder. When an old install's uninstaller would remove
;   the whole folder and a data folder is in it, the installer removes the old
;   app's own files itself, the uninstaller among them, and that install's
;   uninstall entry, so that uninstallOldVersion finds no uninstaller to run
;   (installUtil.nsh:155-163). The entry has to go: with it in place, the run
;   for the current user's install copies its missing uninstaller over the
;   all-users one copied to the same temporary name just before, the copy
;   fails, and the all-users uninstaller is run on the current user's folder
;   (installUtil.nsh:209-224). For the same reason the current user's entry
;   goes, when installing for all users, whenever the uninstaller it names is
;   not there, whatever removed it, and its folder can be reached.
;
; Both installs are checked before anything is moved, and both are moved out
; before either is deleted, so a failure leaves both whole.
;
; The steps run in the instance of the installer that runs uninstallOldVersion,
; after the running app is closed. electron-builder inserts customCheckAppRunning
; in place of its own check, so the stock check is inserted here too; it needs
; the process-info library and $pid, which the template declares only when no
; custom check is defined. The elevated instance skips that check
; (installSection.nsh:34-37), so there the steps run from customInit when it is
; silent, where no page comes before the install, and from the install page
; otherwise.
!include "getProcessInfo.nsh"
Var pid

!ifndef BUILD_UNINSTALLER
  ; The old install being worked on, as uninstallOldVersion finds it, whether
  ; its uninstall entry names an uninstaller that is not there (1), and the
  ; folder its files are moved into while it is removed.
  Var oldInstallDir
  Var oldUninstaller
  Var oldVersion
  Var oldEntryStale
  Var oldAppAside
  ; The same for the two old installs: 1, the one in this install mode, and 2,
  ; the current user's own when installing for all users, else empty. A
  ; Remove of 1 marks an install whose old app is removed here.
  Var oldInstallDir1
  Var oldUninstaller1
  Var oldVersion1
  Var oldEntryStale1
  Var oldAppAside1
  Var oldAppRemove1
  Var oldInstallDir2
  Var oldUninstaller2
  Var oldVersion2
  Var oldEntryStale2
  Var oldAppAside2
  Var oldAppRemove2
  ; The current user's $APPDATA\TFStudio.
  Var userDataDir
  ; In this run: the folder the last profile found in $userDataDir was moved
  ; to, and the old install folder whose profile was copied last.
  Var profileAside
  Var profileCopiedFrom
  ; The message for a step that failed, "" while none has.
  Var oldInstallFailure
  ; The first file of an old app that would not move.
  Var oldAppMoveFailed
  ; The places the data folder search has followed a link to, between bars.
  Var dataSearchLinks
!endif

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    Call prepareOldInstalls
    ${if} $oldInstallFailure != ""
      MessageBox MB_OK|MB_ICONSTOP "$oldInstallFailure" /SD IDOK
      Abort
    ${endIf}
  !endif
!macroend

!macro customInit
  ${if} ${UAC_IsInnerInstance}
  ${andIf} ${Silent}
    Call prepareOldInstallsElevated
  ${endIf}
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW elevatedInstallStarts
  Function elevatedInstallStarts
    ${if} ${UAC_IsInnerInstance}
      Call prepareOldInstallsElevated
    ${endIf}
  FunctionEnd
!macroend

; Reads the old install under ROOT_KEY, as uninstallOldVersion finds it, and
; its version into slot N.
!macro readOldInstall ROOT_KEY N
  !insertmacro readOldInstallValues ${ROOT_KEY}
  Call resolveOldInstall
  !insertmacro storeOldInstall ${N}
!macroend

; The registry values of the old install under ROOT_KEY, from the keys
; uninstallOldVersion reads (installUtil.nsh:155-170).
!macro readOldInstallValues ROOT_KEY
  ReadRegStr $oldUninstaller ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ReadRegStr $oldVersion ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ${if} $oldUninstaller == ""
      ReadRegStr $oldUninstaller ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      ReadRegStr $oldVersion ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY_2}" DisplayVersion
    ${endIf}
  !endif
  ReadRegStr $oldInstallDir ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" InstallLocation
!macroend

; Removes the uninstall entry of the old install under ROOT_KEY, so that
; uninstallOldVersion returns before it copies or runs anything
; (installUtil.nsh:155-163).
!macro forgetOldInstall ROOT_KEY
  DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
!macroend

; The registry part of what the current user's own old uninstaller removes:
; its uninstall entry and its install key.
!macro forgetCurrentUserEntry
  !insertmacro forgetOldInstall HKEY_CURRENT_USER
  DeleteRegKey HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}"
!macroend

; All of what the current user's own old uninstaller removes, for that
; install when its old app was removed here (forgetCurrentUserFiles).
!macro forgetCurrentUserInstall
  Call forgetCurrentUserFiles
  !insertmacro forgetCurrentUserEntry
!macroend

; The app reads $APPDATA as the current user, also when the installer
; installs for all users, where $APPDATA is the all-users folder.
!macro findUserDataDir
  SetShellVarContext current
  StrCpy $userDataDir "$APPDATA\TFStudio"
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endIf}
!macroend

; After the old installs are prepared, before uninstallOldVersion runs: the
; uninstall entry of each old install whose old app was removed goes (slot 1
; under ROOT_KEY), and so does the current user's entry when it names an
; uninstaller that is not there.
!macro forgetPreparedOldInstalls ROOT_KEY
  ${if} $oldAppRemove1 == 1
    !insertmacro forgetOldInstall ${ROOT_KEY}
  ${endIf}
  ${if} $oldAppRemove2 == 1
    !insertmacro forgetCurrentUserInstall
  ${elseIf} $oldEntryStale2 == 1
    !insertmacro forgetCurrentUserEntry
  ${endIf}
!macroend

; What the template's APP_UNASSOCIATE removes, for the current user.
!macro forgetCurrentUserAssociation EXT FILECLASS
  DeleteRegValue HKEY_CURRENT_USER "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
  DeleteRegKey HKEY_CURRENT_USER "Software\Classes\${FILECLASS}"
!macroend

; Slot N to and from the old install being worked on.
!macro storeOldInstall N
  StrCpy $oldInstallDir${N} $oldInstallDir
  StrCpy $oldUninstaller${N} $oldUninstaller
  StrCpy $oldVersion${N} $oldVersion
  StrCpy $oldEntryStale${N} $oldEntryStale
!macroend
!macro selectOldInstall N
  StrCpy $oldInstallDir $oldInstallDir${N}
  StrCpy $oldUninstaller $oldUninstaller${N}
  StrCpy $oldVersion $oldVersion${N}
  StrCpy $oldEntryStale $oldEntryStale${N}
  StrCpy $oldAppAside $oldAppAside${N}
!macroend
!macro clearOldInstall N
  StrCpy $oldInstallDir${N} ""
  StrCpy $oldUninstaller${N} ""
  StrCpy $oldVersion${N} ""
  StrCpy $oldEntryStale${N} ""
!macroend

; The old app of slot N, once moved out, deleted or put back.
!macro deleteMovedOldApp N
  ${if} $oldAppAside${N} != ""
    !insertmacro selectOldInstall ${N}
    RMDir /r "$oldAppAside"
    Call removeOldAppFolders
  ${endIf}
!macroend
!macro restoreMovedOldApp N
  ${if} $oldAppAside${N} != ""
    !insertmacro selectOldInstall ${N}
    Push ""
    Call restoreOldApp
    Push "$oldAppAside"
    Call removeEmptyFolders
  ${endIf}
!macroend

; Copy OLD_DIR\AppData into DATA_DIR when the old install has a profile. A
; profile already in DATA_DIR, left there by a newer build before a downgrade
; or copied from another old install just before, is moved aside to
; DATA_DIR.old rather than merged: the two LevelDB folders inside cannot be
; mixed. One kept aside earlier in this run stays, and the next goes to
; DATA_DIR.old2; a run copies two profiles at most. A copy that fails sets
; $oldInstallFailure, and the install stops before the old uninstaller removes
; anything.
!macro keepInstallData OLD_DIR DATA_DIR
  ${if} ${FileExists} "${OLD_DIR}\AppData\Local Storage\*.*"
    ClearErrors
    ${if} ${FileExists} "${DATA_DIR}\Local Storage\*.*"
      ${if} $profileAside == ""
        StrCpy $profileAside "${DATA_DIR}.old"
      ${else}
        StrCpy $profileAside "${DATA_DIR}.old2"
      ${endIf}
      ${if} ${FileExists} "$profileAside\*.*"
        RMDir /r "$profileAside"
      ${endIf}
      Rename "${DATA_DIR}" "$profileAside"
    ${endIf}
    ${ifNot} ${Errors}
      CreateDirectory "${DATA_DIR}"
      CopyFiles /SILENT "${OLD_DIR}\AppData\*.*" "${DATA_DIR}"
    ${endIf}
    ${if} ${Errors}
      !insertmacro keepDataFailedText $oldInstallFailure
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

; As keepDataFailedText, for a file of the old app that could not be moved.
!macro oldAppNotMovedText OUT FILE
  ${if} $LANGUAGE == 1049
    StrCpy ${OUT} "Обновление остановлено, ничего не удалено: TFStudio не удалось переместить файл старой версии ${FILE}. Закройте TFStudio и запустите установщик снова."
  ${elseIf} $LANGUAGE == 2052
    StrCpy ${OUT} "更新已停止，未删除任何内容：TFStudio 无法移动旧版本的文件 ${FILE}。请关闭 TFStudio，然后重新运行安装程序。"
  ${elseIf} $LANGUAGE == 1040
    StrCpy ${OUT} "L'aggiornamento è stato interrotto e non è stato rimosso nulla: TFStudio non è riuscito a spostare il file ${FILE} della versione precedente. Chiudi TFStudio, poi avvia di nuovo il programma di installazione."
  ${else}
    StrCpy ${OUT} "The update was stopped and nothing was removed: TFStudio could not move the old version's file ${FILE}. Close TFStudio, then run the installer again."
  ${endIf}
!macroend

; The names the old app's own entries have at the top of an old install
; folder: the top level of the packed app folder of 1.8.5 as built with
; Electron 44.5.1 (the main build) and Electron 22.3.27 (the Windows 7 build),
; the uninstaller and its icon, which the installer adds, and the log the app
; writes beside its exe. isOldAppEntry adds the names the packed app has now
; (packedAppEntries), so a name a newer Electron ships is covered too. Any
; other file in an old install folder stays, whatever its name.
!macro oldAppNames DO
  !insertmacro ${DO} "TFStudio.exe"
  !insertmacro ${DO} "Uninstall TFStudio.exe"
  !insertmacro ${DO} "uninstallerIcon.ico"
  !insertmacro ${DO} "app-debug.log"
  !insertmacro ${DO} "resources"
  !insertmacro ${DO} "locales"
  !insertmacro ${DO} "chrome_100_percent.pak"
  !insertmacro ${DO} "chrome_200_percent.pak"
  !insertmacro ${DO} "d3dcompiler_47.dll"
  !insertmacro ${DO} "dxcompiler.dll"
  !insertmacro ${DO} "dxil.dll"
  !insertmacro ${DO} "ffmpeg.dll"
  !insertmacro ${DO} "icudtl.dat"
  !insertmacro ${DO} "libEGL.dll"
  !insertmacro ${DO} "libGLESv2.dll"
  !insertmacro ${DO} "LICENSE.electron.txt"
  !insertmacro ${DO} "LICENSES.chromium.html"
  !insertmacro ${DO} "resources.pak"
  !insertmacro ${DO} "snapshot_blob.bin"
  !insertmacro ${DO} "v8_context_snapshot.bin"
  !insertmacro ${DO} "vk_swiftshader.dll"
  !insertmacro ${DO} "vk_swiftshader_icd.json"
  !insertmacro ${DO} "vulkan-1.dll"
!macroend

; isOldAppEntry's test for one name.
!macro matchOldAppEntry NAME
  ${if} $0 == "${NAME}"
    StrCpy $1 1
  ${endIf}
!macroend

; The functions are compiled here, where the template has defined the names
; of the app's files (common.nsh) and declared $installMode (multiUser.nsh).
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    ; In the instance that is not elevated: slot 1 is the old install in this
    ; install mode, slot 2 the current user's own when installing for all users.
    Function prepareOldInstalls
      !insertmacro findUserDataDir
      !insertmacro readOldInstall SHELL_CONTEXT 1
      !insertmacro clearOldInstall 2
      ${if} $installMode == "all"
        !insertmacro readOldInstall HKEY_CURRENT_USER 2
      ${endIf}
      Call prepareFoundOldInstalls
      ${if} $oldInstallFailure == ""
        !insertmacro forgetPreparedOldInstalls SHELL_CONTEXT
      ${endIf}
    FunctionEnd

    ; The elevated instance always installs for all users, so slot 1 is the
    ; all-users install and slot 2 the current user's own.
    Function prepareOldInstallsElevated
      !insertmacro findUserDataDir
      !insertmacro readOldInstall HKEY_LOCAL_MACHINE 1
      !insertmacro readOldInstall HKEY_CURRENT_USER 2
      Call prepareFoundOldInstalls
      ${if} $oldInstallFailure == ""
        !insertmacro forgetPreparedOldInstalls HKEY_LOCAL_MACHINE
      ${else}
        MessageBox MB_OK|MB_ICONSTOP "$oldInstallFailure" /SD IDOK
        SetErrorLevel 2
        Quit
      ${endIf}
    FunctionEnd

    ; The files and shell entries the current user's own old uninstaller
    ; removes when it runs (uninstaller.nsh:190-254 and customUnInstall), for
    ; that install when its old app was removed above while installing for all
    ; users. The new install writes only the all-users hive, so nothing else
    ; replaces these: the shortcuts and the file association would still lead
    ; to the removed exe, and the association in the current user's hive would
    ; win over the new one.
    Function forgetCurrentUserFiles
      Push $0
      Push $1
      SetShellVarContext current
      ReadRegStr $0 HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" ShortcutName
      ${if} $0 == ""
        StrCpy $0 "${PRODUCT_FILENAME}"
      ${endIf}
      ReadRegStr $1 HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" MenuDirectory
      WinShell::UninstAppUserModelId "${APP_ID}"
      !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
        WinShell::UninstShortcut "$DESKTOP\$0.lnk"
        Delete "$DESKTOP\$0.lnk"
      !endif
      !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
        ${if} $1 == ""
          WinShell::UninstShortcut "$SMPROGRAMS\$0.lnk"
          Delete "$SMPROGRAMS\$0.lnk"
        ${else}
          WinShell::UninstShortcut "$SMPROGRAMS\$1\$0.lnk"
          Delete "$SMPROGRAMS\$1\$0.lnk"
          RMDir "$SMPROGRAMS\$1"
        ${endIf}
      !endif
      !insertmacro customUnInstall
      !insertmacro appFileAssociations forgetCurrentUserAssociation
      SetShellVarContext all
      System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
      Pop $1
      Pop $0
    FunctionEnd

    ; The uninstaller named in UninstallString and, when InstallLocation is
    ; empty, the folder it is in, as uninstallOldVersion finds them
    ; (installUtil.nsh:167-176). $oldEntryStale is 1 when UninstallString is
    ; set, names no uninstaller that is there, and the install folder can be
    ; reached: uninstallOldVersion would run on that folder whatever
    ; uninstaller it copied last. A folder that cannot be reached, on a drive
    ; mapped only in the user's own session or one unplugged, can hold a
    ; working install, and no uninstaller run from here reaches it either.
    Function resolveOldInstall
      StrCpy $oldEntryStale 0
      ${if} $oldUninstaller != ""
        StrCpy $oldEntryStale 1
        Push $oldUninstaller
        Call GetInQuotes
        Pop $oldUninstaller
      ${endIf}
      ${if} $oldInstallDir == ""
      ${andIf} $oldUninstaller != ""
        Push $oldUninstaller
        Call GetFileParent
        Pop $oldInstallDir
      ${endIf}
      ${if} $oldEntryStale == 1
        ${if} $oldUninstaller != ""
        ${andIf} ${FileExists} "$oldUninstaller"
          StrCpy $oldEntryStale 0
        ${elseIf} $oldInstallDir == ""
          StrCpy $oldEntryStale 0
        ${elseIfNot} ${FileExists} "$oldInstallDir\*.*"
          StrCpy $oldEntryStale 0
        ${endIf}
      ${endIf}
    FunctionEnd

    ; The steps for the old installs in slots 1 and 2, before anything is
    ; removed: both profiles are copied, then both installs are checked, and
    ; only then are the old apps beside a data folder moved out, both before
    ; either is deleted. A failure sets $oldInstallFailure with nothing removed.
    Function prepareFoundOldInstalls
      StrCpy $oldInstallFailure ""
      StrCpy $oldAppAside1 ""
      StrCpy $oldAppAside2 ""
      StrCpy $profileAside ""
      StrCpy $profileCopiedFrom ""
      !insertmacro selectOldInstall 1
      Push $INSTDIR
      Call keepOldProfile
      !insertmacro selectOldInstall 2
      Push ""
      Call keepOldProfile
      !insertmacro selectOldInstall 1
      Call checkOldAppRemoval
      Pop $oldAppRemove1
      !insertmacro selectOldInstall 2
      Call checkOldAppRemoval
      Pop $oldAppRemove2
      ${if} $oldInstallFailure == ""
        Call removeCheckedOldApps
      ${endIf}
    FunctionEnd

    ; Copies the profile of the old install being worked on, taken from
    ; FALLBACK when the old install names no folder. Push FALLBACK. Only an
    ; install older than FIRST_APPDATA_PROFILE kept its profile in its folder;
    ; an unknown version counts as older. FALLBACK has no version to tell
    ; which profile is newer, so it only fills an empty $userDataDir and never
    ; replaces or moves a profile in use. A folder whose profile was just
    ; copied is not copied again: the two slots can name the same folder, and
    ; a second copy would move the first aside.
    Function keepOldProfile
      Exch $0
      Push $1
      ${if} $oldInstallDir != ""
        StrCpy $0 $oldInstallDir
        ${VersionCompare} "$oldVersion" "${FIRST_APPDATA_PROFILE}" $1
      ${elseIf} ${FileExists} "$userDataDir\Local Storage\*.*"
        StrCpy $1 0
      ${else}
        StrCpy $1 2
      ${endIf}
      ${if} $oldInstallFailure == ""
      ${andIf} $1 == 2
      ${andIf} $0 != ""
      ${andIf} $0 != $profileCopiedFrom
        !insertmacro keepInstallData "$0" "$userDataDir"
        StrCpy $profileCopiedFrom $0
      ${endIf}
      Pop $1
      Pop $0
    FunctionEnd

    ; 1 when the old app of the install being worked on is to be removed here:
    ; its uninstaller exists, would remove the whole folder (older than
    ; FIRST_SAFE_UNINSTALLER, an unknown version counting as older), and a
    ; data folder is in that folder. A running exe can be renamed but not
    ; deleted, so a running app would show only after part of it had gone; it
    ; cannot be opened for writing while it runs, which is checked here,
    ; before anything moves.
    Function checkOldAppRemoval
      Push $0
      Push $1
      StrCpy $1 0
      ${if} $oldInstallFailure == ""
      ${andIf} $oldInstallDir != ""
      ${andIf} $oldUninstaller != ""
      ${andIf} ${FileExists} "$oldUninstaller"
        ${VersionCompare} "$oldVersion" "${FIRST_SAFE_UNINSTALLER}" $0
        ${if} $0 == 2
          StrCpy $dataSearchLinks "|"
          Push "$oldInstallDir"
          Call holdsDataFolder
          Pop $1
        ${endIf}
      ${endIf}
      ${if} $1 == 1
      ${andIf} ${FileExists} "$oldInstallDir\${APP_EXECUTABLE_FILENAME}"
        ClearErrors
        FileOpen $0 "$oldInstallDir\${APP_EXECUTABLE_FILENAME}" a
        ${if} ${Errors}
          !insertmacro oldAppNotMovedText $oldInstallFailure "$oldInstallDir\${APP_EXECUTABLE_FILENAME}"
          StrCpy $1 0
        ${else}
          FileClose $0
        ${endIf}
      ${endIf}
      StrCpy $0 $1
      Pop $1
      Exch $0
    FunctionEnd

    ; 1 when DIR, or a folder anywhere inside it, holds both Projects and
    ; Materials, which a data folder always has (FOLDER_SPECS in
    ; src/main/userPaths.js). The old uninstaller's RMDir /r goes through
    ; junctions and folder links, so the search goes through them too.
    Function holdsDataFolder
      Exch $0
      Push $1
      Push $2
      Push $3
      Push $4
      StrCpy $4 0
      ${if} ${FileExists} "$0\Projects\*.*"
      ${andIf} ${FileExists} "$0\Materials\*.*"
        StrCpy $4 1
      ${else}
        FindFirst $1 $2 "$0\*.*"
        ${DoWhile} $2 != ""
          ${if} $2 != "."
          ${andIf} $2 != ".."
          ${andIf} ${FileExists} "$0\$2\*.*"
            Push "$0\$2"
            Call searchInto
            Pop $3
            ${if} $3 == 1
              Push "$0\$2"
              Call holdsDataFolder
              Pop $4
            ${elseIf} $3 == 2
              StrCpy $4 1
            ${endIf}
            ${if} $4 == 1
              ${ExitDo}
            ${endIf}
          ${endIf}
          FindNext $1 $2
        ${Loop}
        FindClose $1
      ${endIf}
      StrCpy $0 $4
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Exch $0
    FunctionEnd

    ; 1 to search FOLDER, 0 not to. A link is searched once for each place it
    ; leads to: a link can lead back to a folder above it, and following it
    ; every time would walk the same folders round and round until the paths
    ; grew too long to open. The places are kept in $dataSearchLinks, which
    ; NSIS would cut at NSIS_MAX_STRLEN - 1 characters, after which a place
    ; would no longer be found in it; when another would not fit, the answer
    ; is 2, which counts as a data folder found, so that the old app is
    ; removed file by file rather than by its uninstaller.
    Function searchInto
      Exch $0
      Push $1
      Push $2
      Push $3
      Push $0
      Call isLink
      Pop $1
      ${if} $1 == 1
        StrCpy $1 0
        System::Call 'kernel32::CreateFileW(w r0, i 0, i 7, p 0, i 3, i 0x02000000, p 0) p .r2'
        ${if} $2 <> -1
          System::Call 'kernel32::GetFinalPathNameByHandleW(p r2, w .r3, i ${NSIS_MAX_STRLEN}, i 0) i'
          System::Call 'kernel32::CloseHandle(p r2)'
          Push $dataSearchLinks
          Push "|$3|"
          Call listHas
          Pop $2
          StrLen $0 $dataSearchLinks
          StrLen $1 $3
          IntOp $0 $0 + $1
          IntOp $0 $0 + 1
          IntOp $1 ${NSIS_MAX_STRLEN} - 1
          ${if} $2 == 1
            StrCpy $1 0
          ${elseIf} $0 > $1
            StrCpy $1 2
          ${else}
            StrCpy $dataSearchLinks "$dataSearchLinks$3|"
            StrCpy $1 1
          ${endIf}
        ${endIf}
      ${else}
        StrCpy $1 1
      ${endIf}
      StrCpy $0 $1
      Pop $3
      Pop $2
      Pop $1
      Exch $0
    FunctionEnd

    ; 1 when PATH is a link: a reparse point whose tag, as FindFirstFileW
    ; reports it, has the name-surrogate bit (0x20000000), which junctions,
    ; symbolic links and the other kinds that stand for another path carry.
    ; Other reparse points, such as the folders of a cloud-synced folder like
    ; OneDrive, are folders like any other: the old uninstaller empties them,
    ; and the app's own files in them are removed.
    Function isLink
      Exch $0
      Push $1
      Push $2
      Push $3
      StrCpy $3 0
      System::Alloc 592
      Pop $1
      System::Call 'kernel32::FindFirstFileW(w r0, p r1) p .r2'
      ${if} $2 <> -1
        System::Call 'kernel32::FindClose(p r2)'
        System::Call '*$1(i .r2, i, i, i, i, i, i, i, i, i .r0)'
        IntOp $2 $2 & 0x400
        IntOp $0 $0 & 0x20000000
        ${if} $2 <> 0
        ${andIf} $0 <> 0
          StrCpy $3 1
        ${endIf}
      ${endIf}
      System::Free $1
      StrCpy $0 $3
      Pop $3
      Pop $2
      Pop $1
      Exch $0
    FunctionEnd

    ; 1 when LIST holds ITEM, case ignored. Push LIST, Push ITEM.
    Function listHas
      Exch $1
      Exch
      Exch $0
      Push $2
      Push $3
      Push $4
      StrLen $2 $1
      StrCpy $3 0
      ${Do}
        StrCpy $4 $0 $2 $3
        ${if} $4 == $1
          StrCpy $4 1
          ${ExitDo}
        ${elseIf} $4 == ""
          StrCpy $4 0
          ${ExitDo}
        ${endIf}
        IntOp $3 $3 + 1
      ${Loop}
      StrCpy $0 $4
      Pop $4
      Pop $3
      Pop $2
      Exch
      Pop $1
      Exch $0
    FunctionEnd

    ; 1 when FOLDER is one the removal goes into: not a link, which leads out
    ; of the app's files, and not a data folder.
    Function isPlainFolder
      Exch $0
      Push $1
      Push $0
      Call isLink
      Pop $1
      ${if} $1 == 0
        StrCpy $1 1
        ${if} ${FileExists} "$0\Projects\*.*"
        ${andIf} ${FileExists} "$0\Materials\*.*"
          StrCpy $1 0
        ${endIf}
      ${else}
        StrCpy $1 0
      ${endIf}
      StrCpy $0 $1
      Pop $1
      Exch $0
    FunctionEnd

    ; 1 when NAME, at the top of an old install folder, is one of the old
    ; app's own entries (oldAppNames, packedAppEntries), case ignored.
    Function isOldAppEntry
      Exch $0
      Push $1
      StrCpy $1 0
      !insertmacro oldAppNames matchOldAppEntry
      !insertmacro packedAppEntries matchOldAppEntry
      StrCpy $0 $1
      Pop $1
      Exch $0
    FunctionEnd

    ; Moves the old apps checked above out of their folders, puts every moved
    ; file back if one will not move, and deletes them only once all have
    ; moved. Each folder of moved files is beside the files, on the same
    ; drive, where a move is a rename; a move to another drive copies the
    ; file, and a copy of a file in use goes through while the file stays
    ; (MoveFileEx, MOVEFILE_COPY_ALLOWED).
    Function removeCheckedOldApps
      StrCpy $oldAppMoveFailed ""
      ${if} $oldAppRemove1 == 1
        !insertmacro selectOldInstall 1
        Call moveOldApp
        StrCpy $oldAppAside1 $oldAppAside
      ${endIf}
      ${if} $oldAppRemove2 == 1
      ${andIf} $oldAppMoveFailed == ""
        !insertmacro selectOldInstall 2
        Call moveOldApp
        StrCpy $oldAppAside2 $oldAppAside
      ${endIf}
      ${if} $oldAppMoveFailed == ""
        !insertmacro deleteMovedOldApp 1
        !insertmacro deleteMovedOldApp 2
      ${else}
        !insertmacro restoreMovedOldApp 1
        !insertmacro restoreMovedOldApp 2
        !insertmacro oldAppNotMovedText $oldInstallFailure "$oldAppMoveFailed"
      ${endIf}
    FunctionEnd

    ; Moves the old app being worked on into a new folder beside it,
    ; $oldAppAside. The uninstaller is one of its entries, unless the registry
    ; names a file elsewhere, which is left alone and fails the move.
    Function moveOldApp
      Push $0
      StrCpy $oldAppAside "$oldInstallDir\TFStudio old app"
      StrCpy $0 1
      ${While} ${FileExists} "$oldAppAside"
        IntOp $0 $0 + 1
        StrCpy $oldAppAside "$oldInstallDir\TFStudio old app $0"
      ${EndWhile}
      CreateDirectory "$oldAppAside"
      Call moveOldAppAside
      ${if} $oldAppMoveFailed == ""
      ${andIf} ${FileExists} "$oldUninstaller"
        StrCpy $oldAppMoveFailed "$oldUninstaller"
      ${endIf}
      Pop $0
    FunctionEnd

    ; Moves the old app's entries at the top of $oldInstallDir into
    ; $oldAppAside, a folder file by file.
    Function moveOldAppAside
      Push $0
      Push $1
      Push $2
      FindFirst $0 $1 "$oldInstallDir\*.*"
      ${DoWhile} $1 != ""
        Push $1
        Call isOldAppEntry
        Pop $2
        ${if} $2 == 1
          ${if} ${FileExists} "$oldInstallDir\$1\*.*"
            Push "$oldInstallDir\$1"
            Call isPlainFolder
            Pop $2
            ${if} $2 == 1
              Push "\$1"
              Call moveOldAppFolder
            ${endIf}
          ${else}
            Push "\$1"
            Call moveOldAppFile
          ${endIf}
        ${endIf}
        ${if} $oldAppMoveFailed != ""
          ${ExitDo}
        ${endIf}
        FindNext $0 $1
      ${Loop}
      FindClose $0
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    ; Moves the files under $oldInstallDir\REL into $oldAppAside\REL and leaves
    ; the folders in place for restoreOldApp. Links and data folders inside
    ; stay where they are.
    Function moveOldAppFolder
      Exch $0
      Push $1
      Push $2
      Push $3
      CreateDirectory "$oldAppAside$0"
      FindFirst $1 $2 "$oldInstallDir$0\*.*"
      ${DoWhile} $2 != ""
        ${if} $2 != "."
        ${andIf} $2 != ".."
          ${if} ${FileExists} "$oldInstallDir$0\$2\*.*"
            Push "$oldInstallDir$0\$2"
            Call isPlainFolder
            Pop $3
            ${if} $3 == 1
              Push "$0\$2"
              Call moveOldAppFolder
            ${endIf}
          ${else}
            Push "$0\$2"
            Call moveOldAppFile
          ${endIf}
        ${endIf}
        ${if} $oldAppMoveFailed != ""
          ${ExitDo}
        ${endIf}
        FindNext $1 $2
      ${Loop}
      FindClose $1
      Pop $3
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    Function moveOldAppFile
      Exch $0
      ClearErrors
      Rename "$oldInstallDir$0" "$oldAppAside$0"
      ${if} ${Errors}
        StrCpy $oldAppMoveFailed "$oldInstallDir$0"
      ${endIf}
      Pop $0
    FunctionEnd

    ; Moves every file under $oldAppAside\REL back into $oldInstallDir\REL.
    Function restoreOldApp
      Exch $0
      Push $1
      Push $2
      FindFirst $1 $2 "$oldAppAside$0\*.*"
      ${DoWhile} $2 != ""
        ${if} $2 != "."
        ${andIf} $2 != ".."
          ${if} ${FileExists} "$oldAppAside$0\$2\*.*"
            CreateDirectory "$oldInstallDir$0\$2"
            Push "$0\$2"
            Call restoreOldApp
          ${else}
            Rename "$oldAppAside$0\$2" "$oldInstallDir$0\$2"
          ${endIf}
        ${endIf}
        FindNext $1 $2
      ${Loop}
      FindClose $1
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    ; Removes the folders of the old app's entries, now holding no files.
    Function removeOldAppFolders
      Push $0
      Push $1
      Push $2
      FindFirst $0 $1 "$oldInstallDir\*.*"
      ${DoWhile} $1 != ""
        ${if} ${FileExists} "$oldInstallDir\$1\*.*"
          Push $1
          Call isOldAppEntry
          Pop $2
          ${if} $2 == 1
            Push "$oldInstallDir\$1"
            Call isPlainFolder
            Pop $2
            ${if} $2 == 1
              Push "$oldInstallDir\$1"
              Call removeEmptyFolders
            ${endIf}
          ${endIf}
        ${endIf}
        FindNext $0 $1
      ${Loop}
      FindClose $0
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    ; Removes FOLDER and the folders in it that hold no files, from the bottom
    ; up, without going into links or data folders.
    Function removeEmptyFolders
      Exch $0
      Push $1
      Push $2
      Push $3
      FindFirst $1 $2 "$0\*.*"
      ${DoWhile} $2 != ""
        ${if} $2 != "."
        ${andIf} $2 != ".."
        ${andIf} ${FileExists} "$0\$2\*.*"
          Push "$0\$2"
          Call isPlainFolder
          Pop $3
          ${if} $3 == 1
            Push "$0\$2"
            Call removeEmptyFolders
          ${endIf}
        ${endIf}
        FindNext $1 $2
      ${Loop}
      FindClose $1
      RMDir "$0"
      Pop $3
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd
  !endif
!macroend

; ── What the uninstaller removes ────────────────────────────────────────────
; A folder the user installed into may hold other files, a data folder among
; them. The uninstaller removes only what the app put there, then the folder
; itself if that leaves it empty.
;
; An update runs the old version's uninstaller before the new files are copied
; in. Like electron-builder's own removal, it first moves the app's files into
; its temporary folder, so a file that is in use stops the update with the old
; version whole rather than half removed. That holds when the temporary folder
; is on the same drive: a move to another drive copies the file and leaves one
; in use in place (see removeCheckedOldApps).

; Inserts the macro named by DO once for each entry the app puts in the install
; folder besides the uninstaller: the top level of the packed app folder, as
; tools/install-folder-entries.mjs lists it at build time, the uninstaller's
; icon, and the log the app writes beside its exe (src/main/logger.js).
!macro forEachAppEntry DO
  !insertmacro packedAppEntries ${DO}
  !insertmacro ${DO} "uninstallerIcon.ico"
  !insertmacro ${DO} "app-debug.log"
!macroend

!macro customRemoveFiles
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"
    StrCpy $R0 0
    !insertmacro forEachAppEntry moveAppEntryAside
    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"
      Push ""
      Call un.restoreFiles
      Pop $R0
      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endIf}
  ${endIf}
  SetOutPath $TEMP
  !insertmacro forEachAppEntry removeAppEntry
  ; Left out of the move: the uninstaller may be running from this file, so it
  ; may not move, and an update's installer writes a new one over it.
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  RMDir "$INSTDIR"
!macroend

; Moves NAME into $PLUGINSDIR\old-install. A folder goes through the template's
; un.atomicRMDir, which moves the files in it and leaves its tree in place for
; un.restoreFiles. $R0 is set to the first file that cannot be moved, and
; nothing more is moved after it.
!macro moveAppEntryAside NAME
  ${if} $R0 == 0
    ${if} ${FileExists} "$INSTDIR\${NAME}\*.*"
      CreateDirectory "$PLUGINSDIR\old-install\${NAME}"
      Push "\${NAME}"
      Call un.atomicRMDir
      Pop $R0
    ${elseIf} ${FileExists} "$INSTDIR\${NAME}"
      ClearErrors
      Rename "$INSTDIR\${NAME}" "$PLUGINSDIR\old-install\${NAME}"
      ${if} ${Errors}
        StrCpy $R0 "$INSTDIR\${NAME}"
      ${endIf}
    ${endIf}
  ${endIf}
!macroend

!macro removeAppEntry NAME
  ${if} ${FileExists} "$INSTDIR\${NAME}\*.*"
    RMDir /r "$INSTDIR\${NAME}"
  ${else}
    Delete "$INSTDIR\${NAME}"
  ${endIf}
!macroend
