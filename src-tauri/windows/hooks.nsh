; Uninstalling takes the app off the "Open with" lists it joined for the person (Edit > Settings >
; File Types, written by src-tauri/src/file_types.rs) and removes its object type for Word,
; PowerPoint and Excel (src-tauri/src/ole.rs). An update (/UPDATE) keeps them.
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
    DeleteRegKey HKCU "Software\Classes\CLSID\{171931C4-E8B6-4D52-A649-5D43133B5231}"
    DeleteRegKey HKCU "Software\Classes\ChemIllustrator.Drawing"
    DeleteRegKey HKCU "Software\Classes\ChemIllustrator.Drawing.1"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
