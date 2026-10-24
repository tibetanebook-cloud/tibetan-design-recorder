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
