; Extra uninstall step: electron-builder registers the .tdrec file type but leaves it
; behind on uninstall, pointing at the removed program. Remove it, but only if it
; still belongs to this app, then tell Explorer that file associations changed.
!macro customUnInstall
  ReadRegStr $0 SHCTX "Software\Classes\.tdrec" ""
  StrCmp $0 "Tibetan Design Recorder Project" 0 +3
    DeleteRegKey SHCTX "Software\Classes\.tdrec"
    DeleteRegKey SHCTX "Software\Classes\Tibetan Design Recorder Project"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
