import { newExtensionFiles } from "./templates";

/** A small example extension used by "Open Example Extension". */
export function demoExtensionFiles(): Record<string, string | Uint8Array> {
  const files = newExtensionFiles("VRift Example");
  files["ExtensionInfo.xml"] = (files["ExtensionInfo.xml"] as string)
    .replace("<StartingVisibleNodes>playerComp</StartingVisibleNodes>", "<StartingVisibleNodes>playerComp,exGateway</StartingVisibleNodes>")
    .replace("<StartingTheme>HacknetBlue</StartingTheme>", "<StartingTheme>Themes/RiftTheme.xml</StartingTheme>")
    .replace("  <StartsWithTutorial>", "  <Faction>Factions/Rift.xml</Faction>\n  <StartsWithTutorial>");

  files["Nodes/Gateway.xml"] = `<?xml version="1.0" encoding="UTF-8" ?>
<Computer id="exGateway" name="Rift Gateway" ip="" security="2" allowsDefaultBootModule="false" icon="chip" type="3">
  <adminPass pass="gateway" />
  <ports>21, 22, 80</ports>
  <portsForCrack val="2" />
  <admin type="progress" />
  <dlink target="exIRC" />
  <dlink target="exVault" />
  <file path="home" name="welcome.txt">Gateway online. Watch the IRC for instructions.</file>
  <addWebServer name="Rift Web" url="Web/index.html" />
</Computer>
`;
  files["Nodes/IRC.xml"] = `<?xml version="1.0" encoding="UTF-8" ?>
<Computer id="exIRC" name="Rift IRC" ip="" security="1" allowsDefaultBootModule="true" type="3">
  <positionNear target="exGateway" position="0" total="3" extraDistance="0.1" />
  <IRCDaemon themeColor="67,204,148" name="#rift" needsLogin="false">
    <user name="Vex" color="0,209,232"/>
    <user name="Moth" color="202,98,0"/>
    <post user="Vex">You made it. Crack the vault and grab the key.</post>
  </IRCDaemon>
</Computer>
`;
  files["Nodes/Vault.xml"] = `<?xml version="1.0" encoding="UTF-8" ?>
<Computer id="exVault" name="Cold Vault" ip="" security="3" allowsDefaultBootModule="false" icon="laptop" type="1">
  <positionNear target="exGateway" position="1" total="3" extraDistance="0.1" />
  <adminPass pass="frost" />
  <ports>21, 22, 25, 80</ports>
  <portsForCrack val="3" />
  <proxy time="1" />
  <firewall level="4" solution="KEYS" additionalTime="0.5" />
  <trace time="120" />
  <admin type="progress" />
  <account username="warden" password="icebox" type="ALL" />
  <file path="home" name="key.dat">#BINARY#</file>
  <encryptedFile path="home" name="notes.dec" extension=".txt" ip="" header="Warden notes" pass="frost">The vault key opens more than one door.</encryptedFile>
</Computer>
`;
  files["Missions/StartMission.xml"] = `<?xml version="1.0" encoding="UTF-8" ?>
<mission id="startMission" activeCheck="true" shouldIgnoreSenderVerification="false">
  <goals>
    <goal type="filedownload" target="exVault" file="key.dat" path="home"/>
  </goals>
  <missionStart val="1">addFlags:riftStarted</missionStart>
  <missionEnd val="1">addRankFaction:rift</missionEnd>
  <nextMission IsSilent="false">Missions/Upload.xml</nextMission>
  <email>
    <sender>Vex</sender>
    <subject>First job</subject>
    <body>Get into the Cold Vault and download key.dat.
Reply once you have it.</body>
    <attachments>
      <link comp="exVault" />
      <note title="Hint">The vault has a firewall. Analyze it first.</note>
    </attachments>
  </email>
</mission>
`;
  files["Missions/Upload.xml"] = `<?xml version="1.0" encoding="UTF-8" ?>
<mission id="upload" activeCheck="false" shouldIgnoreSenderVerification="false">
  <goals>
    <goal type="hasflag" target="vaultCleared"/>
  </goals>
  <nextMission IsSilent="false">NONE</nextMission>
  <email>
    <sender>Vex</sender>
    <subject>Clean up</subject>
    <body>Wipe your tracks on the vault, then report back.</body>
    <attachments>
    </attachments>
  </email>
</mission>
`;
  files["Actions/StartingActions.xml"] = `<?xml version="1.0" encoding="UTF-8" ?>
<ConditionalActions>
  <Instantly>
    <RunFunction FunctionName="setFaction:rift" />
    <AddIRCMessage Author="Moth" TargetComp="exIRC" Delay="4">Someone new just connected...</AddIRCMessage>
  </Instantly>
  <OnAdminGained target="exVault">
    <RunFunction FunctionName="addFlags:vaultCleared" />
    <LaunchHackScript Filepath="HackerScripts/Revenge.txt" DelayHost="exIRC" Delay="6" SourceComp="exVault" TargetComp="playerComp" RequireLogsOnSource="true" RequireSourceIntact="true"/>
  </OnAdminGained>
</ConditionalActions>
`;
  files["Factions/Rift.xml"] = `<?xml version="1.0" encoding="UTF-8" ?>
<CustomFaction name="The Rift" id="rift" playerVal="0">
  <Action ValueRequired="1">
    <AddIRCMessage Author="Vex" TargetComp="exIRC" Delay="0">@#PLAYERNAME# welcome to the Rift.</AddIRCMessage>
  </Action>
</CustomFaction>
`;
  files["Themes/RiftTheme.xml"] = `<?xml version="1.0" encoding="UTF-8" ?>
<CustomTheme>
  <themeLayoutName>blue</themeLayoutName>
  <defaultHighlightColor>186,52,255,255</defaultHighlightColor>
  <defaultTopBarColor>40,8,64,255</defaultTopBarColor>
  <moduleColorSolidDefault>90,40,130,255</moduleColorSolidDefault>
  <moduleColorStrong>30,10,50,80</moduleColorStrong>
  <moduleColorBacking>5,6,7,10</moduleColorBacking>
  <exeModuleTopBar>90,30,120,80</exeModuleTopBar>
  <exeModuleTitleText>210,160,255,0</exeModuleTitleText>
  <shellColor>255,200,90,255</shellColor>
  <terminalTextColor>235,220,255,255</terminalTextColor>
  <thisComputerNode>95,220,83,255</thisComputerNode>
</CustomTheme>
`;
  files["HackerScripts/Revenge.txt"] = `config [TARGET_COMP] [SOURCE_COMP] 0.2 $#%#$
connect $#%#$
writel The vault remembers you, #PLAYERNAME#. $#%#$
delay 2 $#%#$
openPort 21 $#%#$
flash $#%#$
disconnect $#%#$
`;
  files["Web/index.html"] = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><link rel="stylesheet" href="Cache/style.css" /></head>
<body><h1>The Rift</h1><p>Nothing to see here.</p></body></html>
`;
  files["Web/Cache/style.css"] = `body { background: #111; color: #c8f; font-family: monospace; }\n`;
  delete files["Web/Cache/.keep"];
  return files;
}
