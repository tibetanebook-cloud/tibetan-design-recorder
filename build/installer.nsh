; The ARM64 installer only contains the ARM64 app. On an Intel/AMD PC it would copy
; nothing and fail at the end ("Error opening file for writing … icon.ico"), so stop
; at the start and say which file to download instead.
!macro customInit
  !ifdef APP_ARM64
    !ifndef APP_64
      ${IfNot} ${IsNativeARM64}
        MessageBox MB_OK|MB_ICONSTOP "This installer is for ARM computers (Windows on ARM, e.g. Snapdragon).$\r$\n$\r$\nThis computer has an Intel or AMD processor. Please download the file ending in:$\r$\n    -Windows-Setup.exe$\r$\n$\r$\nའཇུག་སྒྲིག་ཆས་འདི་ ARM གློག་ཀླད་ཁོ་ནའི་ཆེད་ཡིན། -Windows-Setup.exe ཕབ་ལེན་གནང་རོགས།" /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
    !endif
  !endif
!macroend

; Extra uninstall step: electron-builder registers the .tdrec file type but leaves it
; behind on uninstall, pointing at the removed program. Remove it, but only if it
; still belongs to this app, then tell Explorer that file associations changed.
!macro customUnInstall
  ReadRegStr $0 SHCTX "Software\Classes\.tdrec" ""
  StrCmp $0 "Nangchen T. Studio Screen Recorder Project" tdrecAssocDelete 0
  StrCmp $0 "Tibetan Design Recorder Project" tdrecAssocDelete tdrecAssocDone
  tdrecAssocDelete:
    DeleteRegKey SHCTX "Software\Classes\.tdrec"
  tdrecAssocDone:
  DeleteRegKey SHCTX "Software\Classes\Nangchen T. Studio Screen Recorder Project"
  DeleteRegKey SHCTX "Software\Classes\Tibetan Design Recorder Project"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
