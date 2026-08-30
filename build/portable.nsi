# Fork of electron-builder's templates/nsis/portable.nsi (app-builder-lib 26.15.3).
# Installed over the stock template by tools/run-electron-builder.mjs before every
# build; electron-builder offers no custom-script option for the portable target.
#
# The stock stub either runs silent, unpacking the payload with nothing on
# screen, or, given a splash image, shows a bare installer dialog that flashes at
# launch and reappears as "Setup: Completed" after the app exits. This fork turns
# that dialog into the splash itself: the artwork fills the top of the card, the
# dialog's own progress bar sits in a band beneath it, and the title bar, frame,
# buttons and status text are stripped. The dialog is parked far off-screen until
# it has been laid out, and again before the app starts, so neither the raw
# dialog nor its "Completed" state is ever seen.
#
# The bar is the dialog's native progress control, which is the only thing that
# knows real extraction progress: NSIS drives it as `File /r` writes bytes.
# Windows themes it green, and PBM_SETBARCOLOR is ignored while a control is
# themed, so theming is switched off for it and the colours set directly. That
# buys a flat fill in the product's own colour; a gradient or rounded ends would
# need an owner-drawn control.

!include "common.nsh"
!include "extractAppPackage.nsh"

# https://github.com/electron-userland/electron-builder/issues/3972#issuecomment-505171582
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

# Without a DPI-aware manifest Windows bitmap-stretches the whole dialog on a
# scaled display, which is both larger than intended and blurry. With it, the
# card is laid out in real pixels and the artwork blits 1:1.
ManifestDPIAware true
XPStyle on
# One continuous fill rather than the segmented crawl.
InstProgressFlags smooth
Caption "TFStudio"

# Card geometry in physical pixels. CARD_W x ART_H must match the bitmap
# tools/gen-splash.mjs writes, so SetBrandingImage blits it without resampling.
!define CARD_W 600
!define ART_H  400
!define BAND_H 46
!define BAR_X  28
!define BAR_Y  19
!define BAR_W  544
!define BAR_H  8
# Bar fill and trough, as COLORREF (0x00BBGGRR), from the artwork's palette.
!define BAR_FILL 0x00FFE500
!define BAR_BACK 0x00301A0F

!ifdef SPLASH_IMAGE
  AddBrandingImage top ${ART_H}
!endif

# The only page. Its show callback runs once the page's controls exist, which is
# where the card is assembled and finally moved on screen.
Page instfiles "" layoutSplash

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif

  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir

  !ifdef SPLASH_IMAGE
    ; Park the dialog off-screen before NSIS shows it; layoutSplash brings it
    ; back once it looks like the splash.
    ; 0x0015 = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE.
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i -32000, i -32000, i 0, i 0, i 0x0015)'

    ; Drop the title bar, system menu and sizing frame.
    ; 0xFF33FFFF clears WS_CAPTION | WS_SYSMENU | WS_THICKFRAME.
    System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i .r0'
    IntOp $0 $0 & 0xFF33FFFF
    System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i r0)'

    ; Hide the Install / Cancel / Back row and the branding text.
    GetDlgItem $1 $HWNDPARENT 1
    ShowWindow $1 0
    GetDlgItem $1 $HWNDPARENT 2
    ShowWindow $1 0
    GetDlgItem $1 $HWNDPARENT 3
    ShowWindow $1 0
    GetDlgItem $1 $HWNDPARENT 1028
    ShowWindow $1 0

    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    SetCtlColors $HWNDPARENT "" 0x01030E
  !endif
FunctionEnd

# The card is assembled here, not in .onGUIInit, because NSIS lays the page out
# after that callback returns and would undo any of this done earlier. The window
# stays parked off-screen throughout and is moved into view by the last call.
Function layoutSplash
  !ifdef SPLASH_IMAGE
    ; Make Windows recalculate the non-client area first. .onGUIInit dropped the
    ; caption and frame styles, but until SWP_FRAMECHANGED the window still
    ; measures with the frame it had, and sizing against that stale delta leaves
    ; the client wider than the card — a strip of dialog background down the
    ; right of the artwork.
    ; 0x0037 = SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED.
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i 0, i 0, i 0, i 0, i 0x0037)'

    ; Grow the window to the card size, so the children below have room. The
    ; frame is whatever survived the style strip, so it is measured, not assumed.
    System::Call '*(i 0, i 0, i 0, i 0) p .r3'
    System::Call 'user32::GetWindowRect(p $HWNDPARENT, p r3)'
    System::Call '*$3(i .r4, i .r5, i .r6, i .r7)'
    IntOp $6 $6 - $4        ; window width
    IntOp $7 $7 - $5        ; window height
    System::Call 'user32::GetClientRect(p $HWNDPARENT, p r3)'
    System::Call '*$3(i, i, i .r4, i .r5)'
    IntOp $6 $6 - $4        ; frame width
    IntOp $7 $7 - $5        ; frame height
    IntOp $R2 ${ART_H} + ${BAND_H}
    IntOp $R3 ${CARD_W} + $6
    IntOp $R4 $R2 + $7
    ; 0x0034 = SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED.
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i -32000, i -32000, i R3, i R4, i 0x0034)'

    ; The artwork. Control 1033 is the branding image; sizing it to the bitmap
    ; makes SetBrandingImage's StretchBlt a 1:1 copy, so nothing is resampled.
    ; 0x0014 = SWP_NOZORDER | SWP_NOACTIVATE.
    GetDlgItem $1 $HWNDPARENT 1033
    System::Call 'user32::SetWindowPos(p r1, p 0, i 0, i 0, i ${CARD_W}, i ${ART_H}, i 0x0014)'
    SetBrandingImage /RESIZETOFIT $PLUGINSDIR\splash.bmp

    ; The page dialog becomes the band under the artwork.
    FindWindow $0 "#32770" "" $HWNDPARENT
    SetCtlColors $0 "" 0x01030E
    System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i ${ART_H}, i ${CARD_W}, i ${BAND_H}, i 0x0014)'

    ; The status line, the details list, its button and the page icon have no
    ; place on a splash.
    GetDlgItem $1 $0 1006
    ShowWindow $1 0
    GetDlgItem $1 $0 1016
    ShowWindow $1 0
    GetDlgItem $1 $0 1027
    ShowWindow $1 0
    GetDlgItem $1 $0 1031
    ShowWindow $1 0

    ; The bar: placed in the band, unthemed so it accepts the colours below.
    GetDlgItem $2 $0 1004
    System::Call 'user32::SetWindowPos(p r2, p 0, i ${BAR_X}, i ${BAR_Y}, i ${BAR_W}, i ${BAR_H}, i 0x0014)'
    System::Call 'uxtheme::SetWindowTheme(p r2, w " ", w " ")'
    SendMessage $2 1033 0 ${BAR_FILL}    ; PBM_SETBARCOLOR
    SendMessage $2 8193 0 ${BAR_BACK}    ; PBM_SETBKCOLOR

    ; Centre the finished card, which is what brings it on screen.
    System::Call 'user32::GetSystemMetrics(i 0) i .r4'
    System::Call 'user32::GetSystemMetrics(i 1) i .r5'
    IntOp $4 $4 - $R3
    IntOp $4 $4 / 2
    IntOp $5 $5 - $R4
    IntOp $5 $5 / 2
    ; 0x0015 = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE.
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r4, i r5, i 0, i 0, i 0x0015)'
    System::Free $3
  !endif
FunctionEnd

Section
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  !ifdef UNPACK_DIR_NAME
    StrCpy $INSTDIR "$TEMP\${UNPACK_DIR_NAME}"
  !endif

  RMDir /r $INSTDIR
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        ${endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  ; The unpack is done and the app takes over the screen from here. Hide the card
  ; and park it, so the dialog's "Completed" state, which it reaches after the app
  ; exits while the unpacked payload is deleted, happens out of sight.
  HideWindow
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i -32000, i -32000, i 0, i 0, i 0x0015)'

	ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0" $0
  SetErrorLevel $0

  SetOutPath $EXEDIR
	RMDir /r $INSTDIR
SectionEnd
