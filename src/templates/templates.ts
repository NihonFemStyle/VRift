/**
 * File templates used for "New extension" and "New file".
 * They follow the formats documented in the official Hacknet Extensions guide.
 */

export type FileKind =
  | "extensionInfo"
  | "computer"
  | "mission"
  | "actions"
  | "faction"
  | "theme"
  | "people"
  | "hackerScript"
  | "json"
  | "text"
  | "other"
  /** Kinds added by schema modules ("stuxnetCutscene", "network"…). */
  | (string & {});

export interface NewFileTemplate {
  kind: FileKind;
  label: string;
  folder: string;
  ext: string;
  /** `{{id}}` is replaced with the file's base name. */
  body: string;
  /** Always created at this path (e.g. stuxnet_config.json). */
  fixedPath?: string;
  /** Module that provides the template ("Stuxnet"). */
  module?: string;
}

export const NEW_FILE_TEMPLATES: NewFileTemplate[] = [
  {
    kind: "computer",
    label: "Computer (node)",
    folder: "Nodes",
    ext: ".xml",
    body: `<?xml version="1.0" encoding="UTF-8" ?>
<Computer id="{{id}}" name="{{id}}" ip="" security="2" allowsDefaultBootModule="false" icon="" type="1">
  <adminPass pass="password" />
  <ports>21, 22</ports>
  <portsForCrack val="2" />
  <admin type="progress" />
  <file path="home" name="readme.txt">Welcome to {{id}}.</file>
</Computer>
`,
  },
  {
    kind: "mission",
    label: "Mission",
    folder: "Missions",
    ext: ".xml",
    body: `<?xml version="1.0" encoding="UTF-8" ?>
<mission id="{{id}}" activeCheck="false" shouldIgnoreSenderVerification="false">
  <goals>
    <goal type="getadmin" target="playerComp"/>
  </goals>
  <nextMission IsSilent="false">NONE</nextMission>
  <posting title="{{id}}">Mission posting text.</posting>
  <email>
    <sender>Sender</sender>
    <subject>{{id}}</subject>
    <body>Mission email body.</body>
    <attachments>
    </attachments>
  </email>
</mission>
`,
  },
  {
    kind: "actions",
    label: "Conditional action set",
    folder: "Actions",
    ext: ".xml",
    body: `<?xml version="1.0" encoding="UTF-8" ?>
<ConditionalActions>
  <Instantly>
  </Instantly>
</ConditionalActions>
`,
  },
  {
    kind: "faction",
    label: "Faction",
    folder: "Factions",
    ext: ".xml",
    body: `<?xml version="1.0" encoding="UTF-8" ?>
<CustomFaction name="{{id}}" id="{{id}}" playerVal="0">
  <Action ValueRequired="1">
  </Action>
</CustomFaction>
`,
  },
  {
    kind: "theme",
    label: "Theme",
    folder: "Themes",
    ext: ".xml",
    body: `<?xml version="1.0" encoding="UTF-8" ?>
<CustomTheme>
  <themeLayoutName>blue</themeLayoutName>
  <defaultHighlightColor>0,139,199,255</defaultHighlightColor>
  <defaultTopBarColor>130,65,27,255</defaultTopBarColor>
  <moduleColorSolidDefault>50,59,90,255</moduleColorSolidDefault>
  <moduleColorStrong>14,28,40,80</moduleColorStrong>
  <moduleColorBacking>5,6,7,10</moduleColorBacking>
  <exeModuleTopBar>130,65,27,80</exeModuleTopBar>
  <exeModuleTitleText>155,85,37,0</exeModuleTitleText>
  <warningColor>255,0,0,255</warningColor>
  <subtleTextColor>90,90,90,255</subtleTextColor>
  <darkBackgroundColor>8,8,8,255</darkBackgroundColor>
  <indentBackgroundColor>12,12,12,255</indentBackgroundColor>
  <outlineColor>68,68,68,255</outlineColor>
  <lockedColor>65,16,16,200</lockedColor>
  <brightLockedColor>160,0,0,255</brightLockedColor>
  <brightUnlockedColor>0,160,0,255</brightUnlockedColor>
  <unlockedColor>39,65,36,255</unlockedColor>
  <lightGray>180,180,180,255</lightGray>
  <shellColor>222,201,24,255</shellColor>
  <shellButtonColor>105,167,188,255</shellButtonColor>
  <semiTransText>120,120,120,0</semiTransText>
  <terminalTextColor>213,245,255,255</terminalTextColor>
  <topBarTextColor>126,126,126,100</topBarTextColor>
  <superLightWhite>2,2,2,30</superLightWhite>
  <connectedNodeHighlight>222,0,0,195</connectedNodeHighlight>
  <netmapToolTipColor>213,245,255,0</netmapToolTipColor>
  <netmapToolTipBackground>0,0,0,70</netmapToolTipBackground>
  <topBarIconsColor>255,255,255,255</topBarIconsColor>
  <thisComputerNode>95,220,83,255</thisComputerNode>
  <scanlinesColor>255,255,255,15</scanlinesColor>
</CustomTheme>
`,
  },
  {
    kind: "people",
    label: "Person",
    folder: "People",
    ext: ".xml",
    body: `<?xml version="1.0" encoding="UTF-8" ?>
<Person id="{{id}}" firstName="First" lastName="Last" isMale="true" handle="{{id}}">
  <Birthplace name="Unknown"/>
  <DOB>1/1/1990</DOB>
</Person>
`,
  },
  {
    kind: "hackerScript",
    label: "Hacker script",
    folder: "HackerScripts",
    ext: ".txt",
    body: `config [TARGET_COMP] [SOURCE_COMP] 0.2 $#%#$
connect $#%#$
writel Hello from {{id}} $#%#$
disconnect $#%#$
`,
  },
];

export function extensionInfoTemplate(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<HacknetExtension>
  <Language>en-us</Language>
  <!-- Max name length is 128 characters -->
  <Name>${name}</Name>
  <AllowSaves>true</AllowSaves>
  <!-- Comma separated list of computer IDs that start out visible -->
  <StartingVisibleNodes>playerComp</StartingVisibleNodes>
  <StartingMission>Missions/StartMission.xml</StartingMission>
  <StartingActions>Actions/StartingActions.xml</StartingActions>
  <Description>A new Hacknet extension.</Description>
  <StartsWithTutorial>false</StartsWithTutorial>
  <HasIntroStartup>true</HasIntroStartup>
  <StartingTheme>HacknetBlue</StartingTheme>
  <IntroStartupSong>Ryan3</IntroStartupSong>
  <WorkshopDescription>A new Hacknet extension.</WorkshopDescription>
  <WorkshopLanguage>English</WorkshopLanguage>
  <WorkshopVisibility>2</WorkshopVisibility>
  <WorkshopTags>Extension</WorkshopTags>
  <WorkshopPreviewImagePath>Logo.png</WorkshopPreviewImagePath>
  <WorkshopPublishID>NONE</WorkshopPublishID>
</HacknetExtension>
`;
}

/** A small placeholder Logo.png (the game shows it in the extensions menu). */
const LOGO_PNG_BASE64 = "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";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Files for a brand-new extension. Paths are relative to the extension root. */
export function newExtensionFiles(name: string): Record<string, string | Uint8Array> {
  return {
    "Logo.png": base64ToBytes(LOGO_PNG_BASE64),
    "ExtensionInfo.xml": extensionInfoTemplate(name),
    "Intro.txt": `Welcome to ${name}.\n`,
    "Nodes/PlayerComp.xml": `<?xml version="1.0" encoding="UTF-8" ?>
<Computer id="playerComp" name="Home" security="0" allowsDefaultBootModule="false" type="2">
  <file path="bin" name="SSHCrack.exe">#SSH_CRACK#</file>
  <file path="bin" name="FTPBounce.exe">#FTP_CRACK#</file>
</Computer>
`,
    "Nodes/MailServer.xml": `<?xml version="1.0" encoding="UTF-8" ?>
<Computer id="jmail" name="JMail Email Server" security="4" allowsDefaultBootModule="true" type="3">
  <account username="#PLAYERNAME#" password="password" type="MAIL" />
  <mailServer name="JMail" color="50,237,212" generateJunk="false">
  </mailServer>
</Computer>
`,
    "Missions/StartMission.xml": `<?xml version="1.0" encoding="UTF-8" ?>
<mission id="startMission" activeCheck="true" shouldIgnoreSenderVerification="false">
  <goals>
    <goal type="getadmin" target="playerComp"/>
  </goals>
  <nextMission IsSilent="false">NONE</nextMission>
  <email>
    <sender>Contact</sender>
    <subject>Welcome</subject>
    <body>Welcome, #PLAYERNAME#.</body>
    <attachments>
    </attachments>
  </email>
</mission>
`,
    "Actions/StartingActions.xml": `<?xml version="1.0" encoding="UTF-8" ?>
<ConditionalActions>
  <Instantly>
  </Instantly>
</ConditionalActions>
`,
    "Factions/.keep": "",
    "Themes/.keep": "",
    "People/.keep": "",
    "HackerScripts/.keep": "",
    "Music/.keep": "",
    "Docs/.keep": "",
    "Web/Cache/.keep": "",
  };
}
