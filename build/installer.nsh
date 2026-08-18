; Saoirse 自定义安装欢迎页
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 Saoirse"
  !define MUI_WELCOMEPAGE_TEXT "Saoirse 将在本机安装 DeepSeek Harness 与独立 Node 运行时。$\r$\n$\r$\n安装可能需要几分钟，进度条短暂停留属于正常现象。"
  !insertmacro MUI_PAGE_WELCOME
!macroend
