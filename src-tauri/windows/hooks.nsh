; Uninstalling takes the app off the "Open with" lists it joined for the person (Edit > Settings >
; File Types, written by src-tauri/src/file_types.rs). An update (/UPDATE) keeps them.
!macro CI_FORGET_TYPE EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "ChemIllustrator.${EXT}"
  DeleteRegKey HKCU "Software\Classes\ChemIllustrator.${EXT}"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\RegisteredApplications" "Chem Illustrator"
    DeleteRegKey HKCU "Software\Chem Illustrator"
    !insertmacro CI_FORGET_TYPE "cdxml"
    !insertmacro CI_FORGET_TYPE "cdx"
    !insertmacro CI_FORGET_TYPE "mol"
    !insertmacro CI_FORGET_TYPE "sdf"
    !insertmacro CI_FORGET_TYPE "docx"
    !insertmacro CI_FORGET_TYPE "pptx"
    !insertmacro CI_FORGET_TYPE "xlsx"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
