#!/usr/bin/env python3
"""Build VRift schema modules for Pathfinder mods.

    python scripts/build_mod_schemas.py --stuxnet <StuxnetHN source> --zdtk <ZeroDayToolKit source>

Writes src/schema/mods/stuxnet.json and src/schema/mods/zerodaytoolkit.json.

The tag and attribute lists come from the mods' C# source (scripts/extract_pathfinder.py), so
they match what the game actually reads. Descriptions, value types ("hints") and the extra
structure that is not declared through [XMLStorage] (daemon children, cutscene files, TraceV2
networks...) are curated below from each mod's documentation.

The output uses the same format as a project's VRift.schema.json (see docs/custom-schema.md),
so these files double as worked examples for mod authors.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "src" / "schema" / "mods"

DELAY_HOSTS = ["IRCDaemon", "DHSDaemon", "FastActionHost"]
BOOL = [{"value": "true", "desc": ""}, {"value": "false", "desc": ""}]
ACTION_PARENTS = ["ConditionalActions.*", "CustomFaction.Action"]


def f(name, hint="text", desc="", required=False, default="", **extra):
    d = {"name": name, "required": required, "default": default, "desc": desc, "hint": hint}
    if hint == "bool":
        d.setdefault("enums", BOOL)
        d["ignoreCase"] = True
        d["diag"] = "W"
    d.update(extra)
    return d


def content(hint="text", desc="", **extra):
    d = {"required": False, "default": "", "desc": desc, "hint": hint}
    d.update(extra)
    return d


def delay_fields():
    return [
        f("DelayHost", "computer", "Computer that waits out the delay (needs IRCDaemon, DHSDaemon or FastActionHost)", compFilter=DELAY_HOSTS, diag="E"),
        f("Delay", "text", "Seconds to wait before running (needs DelayHost)", regex=r"^\d+(\.\d+)?$"),
    ]


def run_extractor(src):
    out = subprocess.run([sys.executable, str(HERE / "extract_pathfinder.py"), src], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def build(extracted, curated, module):
    """Merge extracted tags with curated metadata into schema nodes."""
    nodes = []
    for tag, meta in sorted(curated["tags"].items()):
        ex = extracted.get(tag)
        if ex is None and not meta.get("manual"):
            print(f"warning: {module}: {tag} not found in source", file=sys.stderr)
        kind = meta.get("kind") or (ex or {}).get("kind", "action")
        attrs_meta = meta.get("attrs", {})
        attrs = []
        seen = set()
        for fld in (ex or {}).get("fields", []):
            if fld["content"]:
                continue
            key = fld["name"].lower()
            if key in seen:  # mods often declare both "target" and "Target"
                continue
            seen.add(key)
            m = attrs_meta.get(fld["name"]) or attrs_meta.get(key) or next((v for k, v in attrs_meta.items() if k.lower() == key), None)
            if m is None:
                hint = {"bool": "bool", "int": "text", "float": "text"}.get(fld["type"], "text")
                m = f(fld["name"], hint, fld["type"])
            else:
                m = dict(m)
                m["name"] = m.get("name") or fld["name"]
            attrs.append(m)
        for k, m in attrs_meta.items():
            if k.lower() not in seen and m.get("manualAttr"):
                m = dict(m)
                m.pop("manualAttr")
                attrs.append(m)
        if (ex or {}).get("delayable") or meta.get("delayable"):
            attrs += delay_fields()
        if kind == "action":
            paths = meta.get("paths") or [f"{p}.{tag}" for p in ACTION_PARENTS]
        elif kind == "condition":
            paths = meta.get("paths") or [f"ConditionalActions.{tag}"]
        elif kind == "daemon":
            paths = meta.get("paths") or [f"Computer.{tag}"]
        else:
            paths = meta["paths"]
        node = {
            "paths": paths,
            "multi": meta.get("multi", True),
            "desc": meta["desc"],
            "attributes": attrs,
        }
        if kind == "condition":
            node["container"] = True
        for k in ("container", "content", "group"):
            if k in meta:
                node[k] = meta[k]
        content_field = next((x for x in (ex or {}).get("fields", []) if x["content"]), None)
        if content_field and "content" not in node:
            node["content"] = content(desc=meta.get("contentDesc", "Text"))
        nodes.append(node)
    for extra in curated.get("extraNodes", []):
        nodes.append(extra)
    mod = {k: v for k, v in curated.items() if k not in ("tags", "extraNodes")}
    mod["nodes"] = nodes
    return mod


# ---------------------------------------------------------------- Stuxnet

def stuxnet():
    flag = lambda n, d: f(n, "flags", d)
    song = lambda n, d, **kw: f(n, "name", d, ns="stuxnet.song", **kw)
    tags = {
        # RadioV3
        "AddSongToRadio": {"desc": "Give the player RadioV3 song(s)", "group": "Stuxnet · Radio", "attrs": {"SongID": song("SongID", "Song ID(s) from stuxnet_config.json, comma separated", list=True, required=True)}},
        "RemoveSongFromRadio": {"desc": "Remove a song from RadioV3", "group": "Stuxnet · Radio", "attrs": {"SongID": song("SongID", "Song ID from stuxnet_config.json", required=True)}},
        "PreventRadioAccess": {"desc": "Deny RadioV3 access (cutscenes, sequencers…)", "group": "Stuxnet · Radio"},
        "AllowRadioAccess": {"desc": "Allow RadioV3 access again", "group": "Stuxnet · Radio"},
        # Sequencer
        "ChangeSequencerManually": {"desc": "Change the ESequencer target and actions", "group": "Stuxnet · Sequencer", "attrs": {
            "RequiredFlag": f("RequiredFlag", "flags", "Flag needed to start the sequencer"),
            "TargetID": f("TargetID", "computer", "Computer the sequencer targets"),
            "SpinUpTime": f("SpinUpTime", "text", "Spin-up time in seconds"),
            "ActionsToRun": f("ActionsToRun", "actionfile", "Actions to run when the sequencer starts")}},
        "ChangeSequencerFromID": {"desc": "Apply a sequencer preset from stuxnet_config.json", "group": "Stuxnet · Sequencer", "attrs": {"SequencerID": f("SequencerID", "name", "Preset ID from stuxnet_config.json → sequencers", ns="stuxnet.sequencer", required=True)}},
        "ClearCustomSequencer": {"desc": "Go back to the sequencer settings in ExtensionInfo.xml", "group": "Stuxnet · Sequencer"},
        # Saves
        "DenySaves": {"desc": "Stop the player from saving", "group": "Stuxnet · Saves"},
        "AllowSaves": {"desc": "Let the player save again", "group": "Stuxnet · Saves"},
        "RequireFlagForSaves": {"desc": "Only allow saving with (or without) a flag", "group": "Stuxnet · Saves", "attrs": {
            "Flag": f("Flag", "flags", "Flag required to save (empty: no requirement)"),
            "AvoidFlag": f("AvoidFlag", "bool", "true: saving is blocked while the player HAS the flag")}},
        # Vault
        "AddVaultKey": {"desc": "Give the player a key for a VaultDaemon", "group": "Stuxnet · Vault", "attrs": {"KeyName": f("KeyName", "name", "KeyName of the vault", ns="stuxnet.vault", required=True)}},
        "RemoveVaultKey": {"desc": "Take a vault key away", "group": "Stuxnet · Vault", "attrs": {"KeyName": f("KeyName", "name", "KeyName of the vault", ns="stuxnet.vault", required=True)}},
        # Dialogue
        "ShowChapterTitle": {"desc": "Show a full-screen chapter title", "group": "Stuxnet · Dialogue", "attrs": {
            "ChapterTitle": f("ChapterTitle", "text", "Big title, e.g. \"Chapter 1\"", required=True),
            "ChapterSubTitle": f("ChapterSubTitle", "text", "The chapter's name"),
            "HideTopBar": f("HideTopBar", "bool", "Hide the top bar (default true)"),
            "BackingOpacity": f("BackingOpacity", "text", "Opacity of the dimmed background (0-1)")}},
        "HideChapterTitle": {"desc": "Hide the chapter title", "group": "Stuxnet · Dialogue"},
        "ShowCTCDialogue": {"desc": "Visual-novel dialogue; the player clicks to continue", "group": "Stuxnet · Dialogue", "contentDesc": "Dialogue text", "attrs": {
            "TextSpeed": f("TextSpeed", "text", "Text speed multiplier (1 = 10 chars/s)"),
            "HideTopBar": f("HideTopBar", "bool", "Hide the top bar (default true)"),
            "TextColor": f("TextColor", "color", "Text colour, r,g,b"),
            "EndDialogueActions": f("EndDialogueActions", "actionfile", "Actions to run after the player clicks"),
            "BackingOpacity": f("BackingOpacity", "text", "Opacity of the dimmed background (0-1)")}},
        "ShowAutoDialogue": {"desc": "Visual-novel dialogue that continues by itself", "group": "Stuxnet · Dialogue", "contentDesc": "Dialogue text", "attrs": {
            "TextSpeed": f("TextSpeed", "text", "Text speed multiplier (1 = 10 chars/s)"),
            "HideTopBar": f("HideTopBar", "bool", "Hide the top bar (default true)"),
            "TextColor": f("TextColor", "color", "Text colour, r,g,b"),
            "ContinueDelay": f("ContinueDelay", "text", "Seconds to wait after the text finishes"),
            "EndDialogueActions": f("EndDialogueActions", "actionfile", "Actions to run when the dialogue ends"),
            "BackingOpacity": f("BackingOpacity", "text", "Opacity of the dimmed background (0-1)")}},
        "ShowFullscreenCredits": {"desc": "Show full-screen credits", "group": "Stuxnet · Dialogue", "attrs": {
            "CreditsPath": f("CreditsPath", "path", "Credits .txt file (same format as vanilla credits)", pattern="**/*.txt", required=True),
            "ShowButtonDelay": f("ShowButtonDelay", "text", "Seconds before the exit button appears (-1: default)")}},
        "HideFullscreenCredits": {"desc": "Hide the full-screen credits", "group": "Stuxnet · Dialogue"},
        "OnFullscreenCreditsEnd": {"kind": "condition", "desc": "Runs when the full-screen credits end", "group": "Stuxnet", "attrs": {"CheckOnce": f("CheckOnce", "bool", "Remove this condition after it fires once")}},
        # Nodes
        "PlaceNodeOnNetMap": {"desc": "Place a node at a position on the netMap", "group": "Stuxnet · Nodes", "attrs": {
            "TargetCompID": f("TargetCompID", "computer", "Computer to place", required=True),
            "Offset": f("Offset", "text", "Position as x,y fractions of the netMap, e.g. 0.5,0.25", required=True, regex=r"^\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*$")}},
        "SaveNetMap": {"desc": "Save the visible netMap nodes to a cache", "group": "Stuxnet · Nodes", "attrs": {
            "Overwrite": f("Overwrite", "bool", "Overwrite the existing cache"),
            "AutoClear": f("AutoClear", "bool", "Clear the visible nodes after saving")}},
        "LoadNetMap": {"desc": "Restore the netMap saved with SaveNetMap (run SaveNetMap first!)", "group": "Stuxnet · Nodes", "attrs": {"Append": f("Append", "bool", "Add the cached nodes instead of replacing")}},
        "ForceConnectPlayer": {"desc": "Force the player to connect to a computer", "group": "Stuxnet · Nodes", "attrs": {
            "TargetCompID": f("TargetCompID", "computer", "Computer to connect to", required=True),
            "LikeReallyForce": f("LikeReallyForce", "bool", "Keep forcing the connection (rarely needed)"),
            "Intense": f("Intense", "bool", "Stronger visual effect while forcing")}},
        # Wildcards
        "AddCustomWildcard": {"desc": "Define a #WILDCARD# with a fixed value", "group": "Stuxnet · Wildcards", "attrs": {
            "Name": f("Name", "name", "Wildcard name; Test_Wildcard becomes #TEST_WILDCARD#", ns="stuxnet.wildcard", define=True, required=True),
            "Value": f("Value", "text", "Value of the wildcard", required=True)}},
        "AddNodeIPWildcard": {"desc": "Define #NAME_IP# as a node's IP", "group": "Stuxnet · Wildcards", "attrs": {
            "Name": f("Name", "name", "Wildcard name; BitComp becomes #BITCOMP_IP#", ns="stuxnet.wildcard", define=True, required=True),
            "CompID": f("CompID", "computer", "Computer whose IP to use", required=True)}},
        "AddNodeAdminWildcard": {"desc": "Define #NAME_PASS# as a node's admin password", "group": "Stuxnet · Wildcards", "attrs": {
            "Name": f("Name", "name", "Wildcard name; BitComp becomes #BITCOMP_PASS#", ns="stuxnet.wildcard", define=True, required=True),
            "CompID": f("CompID", "computer", "Computer whose admin password to use", required=True)}},
        # Misc
        "DisableAlertsIcon": {"desc": "Hide the mail/IRC alerts icon completely", "group": "Stuxnet"},
        "EnableAlertsIcon": {"desc": "Show the alerts icon again", "group": "Stuxnet"},
        "WriteToTerminal": {"desc": "Print text to the player's terminal", "group": "Stuxnet", "contentDesc": "Text to print", "attrs": {"Quietly": f("Quietly", "bool", "Don't play the beep (default true)")}},
        "ForceCloseGame": {"desc": "Close the game immediately. Use sparingly!", "group": "Stuxnet"},
        "LogMessage": {"desc": "Write to the BepInEx log (debugging)", "group": "Stuxnet", "contentDesc": "Message", "attrs": {"LogType": f("LogType", "enum", "Log level", enums=[{"value": "debug", "desc": ""}, {"value": "info", "desc": ""}, {"value": "warning", "desc": ""}, {"value": "error", "desc": ""}], ignoreCase=True)}},
        "OnForkbombComplete": {"kind": "condition", "desc": "Runs when a forkbomb completes on the player's PC", "group": "Stuxnet", "attrs": {
            "PreventCrash": f("PreventCrash", "bool", "Kill the forkbomb instead of crashing the PC"),
            "DiscardOnKilled": f("DiscardOnKilled", "bool", "Discard these actions if the player kills a forkbomb")}},
        "OnExtSequencerKill": {"kind": "condition", "desc": "Runs when no extension sequencer is running any more", "group": "Stuxnet"},
        "HasFlagsStx": {"kind": "condition", "desc": "Like HasFlags, with CheckOnce", "group": "Stuxnet", "attrs": {
            "requiredFlags": f("requiredFlags", "flags", "Comma separated flags the player must have", required=True),
            "CheckOnce": f("CheckOnce", "bool", "Check once, then remove this condition")}},
        "DoesNotHaveFlagsStx": {"kind": "condition", "desc": "Like DoesNotHaveFlags, with CheckOnce", "group": "Stuxnet", "attrs": {
            "Flags": f("Flags", "flags", "Comma separated flags the player must NOT have", required=True),
            "CheckOnce": f("CheckOnce", "bool", "Check once, then remove this condition")}},
        # Persistence
        "AddPersistentFlag": {"desc": "Add a flag kept across save files", "group": "Stuxnet · Persistence", "attrs": {"Flag": f("Flag", "name", "Persistent flag", ns="stuxnet.pflag", define=True, required=True)}},
        "RemovePersistentFlag": {"desc": "Remove a persistent flag", "group": "Stuxnet · Persistence", "attrs": {"Flag": f("Flag", "name", "Persistent flag", ns="stuxnet.pflag", required=True)}},
        "ClearPersistentFlags": {"desc": "Remove all persistent flags", "group": "Stuxnet · Persistence"},
        "HasPersistentFlags": {"kind": "condition", "desc": "Runs if persistent data has these flags", "group": "Stuxnet · Persistence", "attrs": {
            "Flags": f("Flags", "name", "Comma separated persistent flags", ns="stuxnet.pflag", list=True, required=True),
            "CheckOnce": f("CheckOnce", "bool", "Check once, then remove this condition")}},
        "DoesNotHavePersistentFlags": {"kind": "condition", "desc": "Runs if persistent data lacks these flags", "group": "Stuxnet · Persistence", "attrs": {
            "Flags": f("Flags", "name", "Comma separated persistent flags", ns="stuxnet.pflag", list=True, required=True),
            "CheckOnce": f("CheckOnce", "bool", "Check once, then remove this condition")}},
        "CollectAchievement": {"desc": "Unlock an achievement from stuxnet_config.json", "group": "Stuxnet · Persistence", "attrs": {
            "Name": f("Name", "name", "Achievement name (case-sensitive)", ns="stuxnet.achievement", required=True),
            "Quietly": f("Quietly", "bool", "Don't show the pop-up")}},
        # Quests
        "LoadSideQuest": {"desc": "Load a mission as a side quest (no email is sent)", "group": "Stuxnet · Quests", "attrs": {
            "MissionName": f("MissionName", "missionfile", "Mission file", required=True),
            "ID": f("ID", "name", "Quest ID (default: the mission's id)", ns="stuxnet.quest", define=True)}},
        "UnloadSideQuest": {"desc": "Remove a side quest without running its end actions", "group": "Stuxnet · Quests", "attrs": {"QuestID": f("QuestID", "name", "Quest ID", ns="stuxnet.quest", required=True)}},
        "ReplaceMainMission": {"desc": "Replace the current main mission (needs replaceLoadMissionAction)", "group": "Stuxnet · Quests", "attrs": {"MissionName": f("MissionName", "missionfile", "Mission file", required=True)}},
        "ToggleQuestsButton": {"desc": "Enable or disable the Quests system", "group": "Stuxnet · Quests", "attrs": {"Enable": f("Enable", "bool", "true: enable quests")}},
        # SMS
        "SendSMSMessage": {"desc": "Send a message in the SMS messenger", "group": "Stuxnet · SMS", "attrs": {
            "Author": f("Author", "text", "Author (#PLAYERNAME# for the player)", required=True, wildcards=True),
            "ChannelName": f("ChannelName", "name", "Channel (defaults to the author)", ns="stuxnet.sms", define=True),
            "OnReadActions": f("OnReadActions", "actionfile", "Actions to run when the message is first read"),
            "MessageID": f("MessageID", "name", "ID for cancelling a queued message", ns="stuxnet.smsmsg", define=True),
            "MessageDelay": f("MessageDelay", "text", "Queue the message for this many seconds")}},
        "CancelSMSMessage": {"desc": "Cancel a queued SMS message", "group": "Stuxnet · SMS", "attrs": {"MessageID": f("MessageID", "name", "MessageID of the queued message", ns="stuxnet.smsmsg", required=True)}},
        "SMSShowChoices": {"desc": "Show up to three reply choices", "group": "Stuxnet · SMS", "attrs": {
            "ChannelName": f("ChannelName", "name", "Channel", ns="stuxnet.sms", required=True),
            "Timer": f("Timer", "text", "Seconds before the choices disappear (0: no limit)")}},
        "SMSHideChoices": {"desc": "Hide the choices; runs actions if any were showing", "group": "Stuxnet · SMS", "attrs": {"OnSuccessActions": f("OnSuccessActions", "actionfile", "Actions to run if choices were hidden")}},
        "ForceOpenSMSChannel": {"desc": "Open an SMS channel, even if SMS is forbidden", "group": "Stuxnet · SMS", "attrs": {"ChannelName": f("ChannelName", "name", "Channel", ns="stuxnet.sms", required=True)}},
        "ForceCloseSMS": {"desc": "Close the SMS module", "group": "Stuxnet · SMS"},
        "ForbidSMS": {"desc": "Forbid (or allow) opening SMS with the messenger command", "group": "Stuxnet · SMS", "attrs": {"AllowSMS": f("AllowSMS", "bool", "true: allow SMS again")}},
        "SMSBlockUser": {"desc": "Show a 'blocked' system message (cosmetic)", "group": "Stuxnet · SMS", "attrs": {
            "UserBeingBlocked": f("UserBeingBlocked", "text", "Author being blocked", required=True),
            "BlockingUser": f("BlockingUser", "text", "Author doing the blocking (default: the player)", wildcards=True)}},
        "SMSAddUser": {"desc": "Show a 'user added' system message (cosmetic)", "group": "Stuxnet · SMS", "attrs": {
            "UserBeingAdded": f("UserBeingAdded", "text", "Author being added", required=True, wildcards=True),
            "UserAdding": f("UserAdding", "text", "Author adding them"),
            "ChannelName": f("ChannelName", "name", "Channel", ns="stuxnet.sms")}},
        "SMSGoOffline": {"desc": "Show an 'offline' system message (cosmetic)", "group": "Stuxnet · SMS", "attrs": {
            "User": f("User", "text", "Author going offline", required=True),
            "ChannelName": f("ChannelName", "name", "Channel", ns="stuxnet.sms")}},
        "SMSFailSendMessage": {"desc": "Show 'Message failed to send'", "group": "Stuxnet · SMS", "attrs": {"ChannelName": f("ChannelName", "name", "Channel", ns="stuxnet.sms", required=True)}},
        # Cutscenes
        "PreloadCutscene": {"desc": "Load a cutscene file into memory", "group": "Stuxnet · Cutscenes", "attrs": {"FilePath": f("FilePath", "path", "Cutscene XML", pattern="**/*.xml", required=True, kinds=["stuxnetCutscene"])}},
        "TriggerCutscene": {"desc": "Play a preloaded cutscene", "group": "Stuxnet · Cutscenes", "attrs": {"FilePath": f("FilePath", "path", "Cutscene XML (preload it first)", pattern="**/*.xml", required=True, kinds=["stuxnetCutscene"])}},
        "OnCutsceneEnd": {"kind": "condition", "desc": "Runs when the current cutscene ends", "group": "Stuxnet · Cutscenes"},
        # Audio (Stuxnet.Audio)
        "PlaySound": {"desc": "Play a built-in sound effect", "group": "Stuxnet · Audio", "attrs": {"SoundID": f("SoundID", "enum", "Sound", required=True, ignoreCase=True, diag="W", enums=[
            {"value": "beep", "desc": "Beep (write/writel)"}, {"value": "crash", "desc": "HackerScript stopMusic stinger"}, {"value": "connect", "desc": "Bip (adding a node)"},
            {"value": "mail", "desc": "You've got mail"}, {"value": "etasspindown", "desc": "ETAS spin-down"}, {"value": "etasspinup", "desc": "ETAS spin-up"},
            {"value": "etasimpact", "desc": "ETAS impact"}, {"value": "bang", "desc": "Gunshot"}, {"value": "irc", "desc": "IRC notification"},
            {"value": "warning", "desc": "= beep"}, {"value": "harsh", "desc": "= crash"}, {"value": "stinger", "desc": "= crash"}, {"value": "melt", "desc": "= crash"},
            {"value": "meltimpact", "desc": "= crash"}, {"value": "addnode", "desc": "= connect"}, {"value": "bip", "desc": "= connect"}, {"value": "newmail", "desc": "= mail"},
            {"value": "spindown", "desc": "= etasspindown"}, {"value": "etas1", "desc": "= etasspindown"}, {"value": "spinup", "desc": "= etasspinup"}, {"value": "etas2", "desc": "= etasspinup"},
            {"value": "impact", "desc": "= etasimpact"}, {"value": "etas3", "desc": "= etasimpact"}, {"value": "gunshot", "desc": "= bang"}, {"value": "notification", "desc": "= irc"},
        ] + [{"value": str(i), "desc": ""} for i in range(1, 10)])}},
        "PlayCustomSound": {"desc": "Play an .ogg (or .wav) sound effect", "group": "Stuxnet · Audio", "attrs": {"SoundFile": f("SoundFile", "path", "Sound file", pattern="**/*.{ogg,wav}", required=True)}},
        "PlayCustomSong": {"desc": "Play a song, optionally with loop points", "group": "Stuxnet · Audio", "attrs": {
            "SongFile": f("SongFile", "path", "Song .ogg file", pattern="**/*.ogg", required=True),
            "Immediately": f("Immediately", "bool", "Switch without fading"),
            "BeginLoop": f("BeginLoop", "text", "Loop start in ms (-1: none)"),
            "EndLoop": f("EndLoop", "text", "Loop end in ms (-1: none)")}},
        # Stuxnet.Audio's docs mention FadeOut, but the action ignores it (it always calls MusicManager.stop()).
        "StopMusic": {"desc": "Stop the music", "group": "Stuxnet · Audio"},
        "PreloadSong": {"desc": "Load a song into the music cache", "group": "Stuxnet · Audio", "attrs": {"SongFile": f("SongFile", "path", "Song .ogg file", pattern="**/*.ogg", required=True)}},
        "OnSongInCache": {"kind": "condition", "desc": "Runs once a song is cached", "group": "Stuxnet · Audio", "attrs": {
            "SongFile": f("SongFile", "path", "Song .ogg file", pattern="**/*.ogg", required=True),
            "CacheIfNotExists": f("CacheIfNotExists", "bool", "Start caching the song if needed")}},
        # Daemons
        "CodeRedemptionDaemon": {"kind": "daemon", "multi": False, "desc": "Lets the player enter codes from stuxnet_config.json", "attrs": {
            "CodePrefix": f("CodePrefix", "text", "Prefix shown before the typed code"),
            "Message": f("Message", "text", "Server message")}},
        "DebugDaemon": {"kind": "daemon", "multi": False, "desc": "Only reachable with debug commands enabled", "attrs": {"RequiredPassword": f("RequiredPassword", "text", "Save-file password also required (optional)")}},
        "VaultDaemon": {"kind": "daemon", "multi": False, "desc": "A vault that opens once the player has enough keys", "attrs": {
            "Name": f("Name", "text", "Vault name shown on screen"),
            "KeyName": f("KeyName", "name", "Key name used by AddVaultKey (keep it unique)", ns="stuxnet.vault", define=True, required=True),
            "MaximumKeys": f("MaximumKeys", "text", "Keys needed, 1-10 (default 5)"),
            "Message": f("Message", "text", "Message at the bottom"),
            "SecretCode": f("SecretCode", "text", "Code shown when opened; also becomes the admin password (random if empty)")}},
        "BYODDaemon": {"kind": "daemon", "manual": True, "desc": "Build Your Own Daemon: a static screen drawn from XML", "container": True, "attrs": {
            "Name": f("Name", "text", "Daemon name", required=True, manualAttr=True),
            "IncludeExitButton": f("IncludeExitButton", "bool", "Add an exit button (default true)", manualAttr=True)}},
    }
    vec = lambda n, d, req=True: f(n, "text", d, required=req, regex=r"^\s*-?\d*\.?\d+\s*(,\s*-?\d*\.?\d+\s*)?$")
    color = lambda n, d, req=False: f(n, "color", d, required=req)
    el_id = f("ID", "name", "Element ID used by instructions", ns="stuxnet.anim", define=True, required=True, scope="file")
    target = f("ElementID", "name", "ID of the element to animate", ns="stuxnet.anim", required=True, scope="file")
    t_dur = f("Duration", "text", "Seconds", required=True)
    t_delay = f("Delay", "text", "Seconds after the start of the animation", required=True)
    anim_nodes = []
    for root in ("StuxnetCutscene", "StuxnetAnimatedTheme"):
        anim_nodes += [
            {"paths": [f"{root}.Elements"], "multi": False, "container": True, "desc": "Elements (drawn in order)", "attributes": []},
            {"paths": [f"{root}.Instructions"], "multi": False, "container": True, "desc": "Timed instructions", "attributes": []},
            {"paths": [f"{root}.Elements.Rectangle"], "multi": True, "desc": "Solid rectangle", "attributes": [el_id, vec("Position", "x,y (values under 1 are fractions)"), vec("Size", "w,h (values under 1 are fractions)"), color("Color", "r,g,b", True), f("Rotation", "text", "Degrees"), f("Visible", "bool", "Start visible"), f("Opacity", "text", "Starting opacity 0-1")]},
            {"paths": [f"{root}.Elements.Image"], "multi": True, "desc": "Image", "attributes": [el_id, vec("Position", "x,y"), vec("Size", "w,h"), f("FilePath", "path", "Image file", pattern="**/*.{png,jpg,jpeg}", required=True), f("Rotation", "text", "Degrees"), f("Visible", "bool", "Start visible"), f("Opacity", "text", "Starting opacity 0-1")]},
            {"paths": [f"{root}.Elements.Text"], "multi": True, "desc": "Text (wraps at Size width)", "attributes": [el_id, vec("Position", "x,y"), vec("Size", "w (h is ignored)"), f("StartingValue", "text", "Text", required=True), f("FontScale", "text", "Font scale"), color("Color", "r,g,b"), f("Visible", "bool", "Start visible"), f("Opacity", "text", "Starting opacity 0-1")]},
            {"paths": [f"{root}.Elements.RaindropsFX"], "multi": True, "desc": "Raindrops effect (RadioV3 style)", "attributes": [el_id, f("FallRate", "text", "Fall speed (0.5 is a good start)", required=True), f("MaxDropsRadius", "text", "Puddle size", required=True), f("DropsPerSecond", "text", "Drops per second", required=True), color("DropsColor", "r,g,b")]},
            {"paths": [f"{root}.Elements.GridFX"], "multi": True, "desc": "Shifting grid effect (MemForensics style)", "attributes": [el_id, vec("Position", "x,y"), vec("Size", "w,h"), color("Color", "r,g,b (avoid pure white/black)")]},
            {"paths": [f"{root}.Instructions.Translate"], "multi": True, "desc": "Move an element", "attributes": [target, t_dur, t_delay, vec("TargetPosition", "x,y")]},
            {"paths": [f"{root}.Instructions.Resize"], "multi": True, "desc": "Resize an element", "attributes": [target, t_dur, t_delay, vec("TargetSize", "w,h")]},
            {"paths": [f"{root}.Instructions.Rotate"], "multi": True, "desc": "Rotate to an angle, or spin forever", "attributes": [target, f("Duration", "text", "Seconds (timed rotation)"), t_delay, f("TargetAngle", "text", "Degrees (timed rotation)"), f("Indefinitely", "bool", "Spin forever (false stops spinning)"), f("Speed", "text", "Degrees per second (with Indefinitely)")]},
            {"paths": [f"{root}.Instructions.Fade"], "multi": True, "desc": "Fade an element in or out", "attributes": [target, t_dur, t_delay, f("FadeIn", "bool", "true: start invisible and fade in", required=True)]},
            {"paths": [f"{root}.Instructions.ToggleVisibility"], "multi": True, "desc": "Show or hide an element", "attributes": [target, f("Duration", "text", "Seconds"), t_delay, f("Visible", "bool", "Visible?", required=True)]},
            {"paths": [f"{root}.Instructions.Typewriter"], "multi": True, "desc": "Type text out (Text elements only); empty Text erases", "attributes": [target, t_dur, t_delay, f("Text", "text", "Text to type")]},
            {"paths": [f"{root}.Instructions.ChangeFontScale"], "multi": True, "desc": "Change a Text element's font scale", "attributes": [target, t_dur, t_delay, f("TargetScale", "text", "New scale", required=True)]},
        ]
    extra = [
        {"paths": ["StuxnetCutscene"], "multi": False, "container": True, "desc": "Stuxnet cutscene (play with PreloadCutscene + TriggerCutscene)", "attributes": []},
        {"paths": ["StuxnetCutscene.Instructions.DelayEnd"], "multi": False, "desc": "Delay the end of the cutscene (put last)", "attributes": [f("Delay", "text", "Seconds after the start", required=True)]},
        {"paths": ["StuxnetAnimatedTheme"], "multi": False, "container": True, "desc": "Stuxnet animated theme (use like a theme file)", "attributes": []},
        {"paths": ["StuxnetAnimatedTheme.BaseTheme"], "multi": False, "desc": "Underlying vanilla theme", "attributes": [], "content": content("themefile", "Theme file path")},
        *anim_nodes,
        {"paths": ["Computer.BYODDaemon.Rectangle"], "multi": True, "desc": "Solid rectangle", "attributes": [vec("Position", "x,y (values 0-1 are fractions)"), vec("Size", "w,h (negative h: square)"), color("Color", "r,g,b", True)]},
        {"paths": ["Computer.BYODDaemon.Image"], "multi": True, "desc": "Image", "attributes": [vec("Position", "x,y"), vec("Size", "w,h"), f("Path", "path", "Image file", pattern="**/*.{png,jpg,jpeg}", required=True)]},
        {"paths": ["Computer.BYODDaemon.Label"], "multi": True, "desc": "Text label", "content": content("text", "Label text"), "attributes": [vec("Position", "x,y"), f("FontType", "enum", "Font", enums=[{"value": v, "desc": ""} for v in ("normal", "title", "small", "tiny")], diag="W"), f("FontSize", "text", "Size multiplier"), color("TextColor", "r,g,b")]},
        {"paths": ["Computer.BYODDaemon.Button"], "multi": True, "desc": "Button that runs actions", "content": content("text", "Button text"), "attributes": [vec("Position", "x,y"), vec("Size", "w,h"), f("OnPressedActions", "actionfile", "Actions to run"), color("Color", "r,g,b"), f("IsExitButton", "bool", "Leave the daemon when pressed (default true)")]},
        {"paths": ["Computer.BYODDaemon.WarningTape"], "multi": True, "desc": "Warning tape (like proxies/firewalls)", "attributes": [vec("Position", "x,y"), vec("Size", "w,h"), color("PrimaryColor", "r,g,b", True), color("SecondaryColor", "r,g,b", True)]},
        {"paths": ["Computer.wiresharkCapture"], "multi": True, "container": True, "desc": "A Wireshark .pcap file the player can open", "attributes": [f("path", "text", "Folder on the computer", required=True), f("name", "text", "File name", required=True)]},
        {"paths": ["Computer.WiresharkEntries"], "multi": False, "container": True, "desc": "Packets captured with Wireshark --capture", "attributes": []},
        *[{"paths": [p], "multi": True, "desc": "Captured packet", "content": content("text", "Packet data"), "attributes": [
            f("id", "text", "Packet number"), f("from", "ip", "Source IP"), f("to", "ip", "Destination IP"),
            f("method", "enum", "HTTP method", enums=[{"value": v, "desc": ""} for v in ("GET", "POST", "PUT", "DELETE", "HEAD")]),
            f("protocol", "enum", "Protocol", enums=[{"value": v, "desc": ""} for v in ("TCP", "UDP", "DNS", "SSL", "HTTP")]),
            f("secure", "bool", "Needs admin on the source computer to read")]} for p in ("Computer.wiresharkCapture.pcap", "Computer.WiresharkEntries.pcap")],
        {"paths": [f"{p}.SendSMSMessage.Message" for p in ACTION_PARENTS], "multi": False, "desc": "Message text", "content": content("text", "Message", wildcards=True), "attributes": []},
        {"paths": [f"{p}.SendSMSMessage.UserNote" for p in ACTION_PARENTS], "multi": True, "desc": "Attachment: a note for notes.exe", "content": content("text", "Note text"), "attributes": [f("DisplayName", "text", "Name shown on the attachment", required=True)]},
        {"paths": [f"{p}.SendSMSMessage.NodeAttachment" for p in ACTION_PARENTS], "multi": True, "desc": "Attachment: link to a node", "attributes": [f("DisplayName", "text", "Name shown on the attachment"), f("NodeID", "computer", "Computer", required=True)]},
        {"paths": [f"{p}.SendSMSMessage.NodeAccount" for p in ACTION_PARENTS], "multi": True, "desc": "Attachment: account on a node", "attributes": [f("DisplayName", "text", "Name shown on the attachment"), f("NodeID", "computer", "Computer", required=True), f("AccountUsername", "compchild", "Account username", required=True, **{"from": "NodeID", "child": ["account"], "childAttr": "username"})]},
        {"paths": [f"{p}.SMSShowChoices.Choice" for p in ACTION_PARENTS], "multi": True, "desc": "A choice", "content": content("text", "Choice text"), "attributes": [f("OnChosenActions", "actionfile", "Actions to run when chosen", required=True)]},
    ]
    return {
        "id": "stuxnet",
        "name": "Stuxnet",
        "version": "2.x",
        "url": "https://github.com/AutumnRivers/StuxnetHN",
        "description": "Autumn Rivers' all-in-one extension mod: RadioV3, SMS, quests, cutscenes, vaults, BYOD daemons, persistence and more.",
        "detect": {"files": ["stuxnet_config.json"], "plugins": "stuxnet", "roots": ["StuxnetCutscene", "StuxnetAnimatedTheme"]},
        "daemons": ["CodeRedemptionDaemon", "DebugDaemon", "VaultDaemon", "BYODDaemon"],
        "executables": [{"value": "#RADIO_V3#", "desc": "RadioV3 (Stuxnet)"}, {"value": "#WIRESHARK_EXE#", "desc": "Wireshark (Stuxnet)"}],
        "fileKinds": [
            {"root": "StuxnetCutscene", "kind": "stuxnetCutscene", "label": "Cutscene", "folder": "Cutscenes", "icon": "▶"},
            {"root": "StuxnetAnimatedTheme", "kind": "stuxnetAnimatedTheme", "label": "Animated theme", "folder": "Themes", "icon": "◑", "alias": "theme"},
        ],
        "enumExtensions": {
            "Computer@icon": [
                {"value": "sec0", "desc": "Security 0 computer (Stuxnet)"}, {"value": "sec1", "desc": "Security 1 computer (Stuxnet)"},
                {"value": "sec2", "desc": "Security 2 computer (Stuxnet)"}, {"value": "computer", "desc": "Computer (Stuxnet)"},
                {"value": "oldServer", "desc": "Old server (Stuxnet)"}],
            "ConditionalActions.*.SetLock@Module": [{"value": "sms", "desc": "Stuxnet SMS module"}],
        },
        "names": {
            "stuxnet.song": {"label": "RadioV3 song", "severity": "error", "source": "stuxnet_config.json → audio.songs"},
            "stuxnet.sequencer": {"label": "sequencer preset", "severity": "error", "source": "stuxnet_config.json → sequencers"},
            "stuxnet.achievement": {"label": "achievement", "severity": "error", "source": "stuxnet_config.json → achievements"},
            "stuxnet.vault": {"label": "vault key", "severity": "warning", "source": "a VaultDaemon's KeyName"},
            "stuxnet.wildcard": {"label": "custom wildcard", "severity": "none"},
            "stuxnet.sms": {"label": "SMS channel", "severity": "info", "source": "SendSMSMessage"},
            "stuxnet.smsmsg": {"label": "queued SMS message", "severity": "warning", "source": "SendSMSMessage MessageID"},
            "stuxnet.quest": {"label": "side quest", "severity": "info", "source": "LoadSideQuest ID (or the mission's id)"},
            "stuxnet.pflag": {"label": "persistent flag", "severity": "info", "source": "AddPersistentFlag"},
            "stuxnet.anim": {"label": "animation element", "severity": "error", "source": "an element ID in this file"},
        },
        "provider": "stuxnetConfig",
        "templates": [
            {"kind": "stuxnetCutscene", "label": "Stuxnet cutscene", "folder": "Cutscenes", "ext": ".xml", "body": "<StuxnetCutscene>\n  <Elements>\n    <Rectangle ID=\"bg\" Position=\"0,0\" Size=\"1,1\" Color=\"0,0,0\" />\n    <Text ID=\"title\" Position=\"0.1,0.45\" Size=\"0.8,0.1\" StartingValue=\"\" FontScale=\"1.5\" Color=\"255,255,255\" />\n  </Elements>\n  <Instructions>\n    <Fade ElementID=\"bg\" Duration=\"1\" Delay=\"0\" FadeIn=\"true\" />\n    <Typewriter ElementID=\"title\" Duration=\"2\" Delay=\"1\" Text=\"{{id}}\" />\n    <DelayEnd Delay=\"5\" />\n  </Instructions>\n</StuxnetCutscene>\n"},
            {"kind": "stuxnetAnimatedTheme", "label": "Stuxnet animated theme", "folder": "Themes", "ext": ".xml", "body": "<StuxnetAnimatedTheme>\n  <BaseTheme>Themes/ExampleTheme.xml</BaseTheme>\n  <Elements>\n    <GridFX ID=\"grid\" Position=\"0,0\" Size=\"1,1\" Color=\"40,80,120\" />\n  </Elements>\n  <Instructions>\n    <ToggleVisibility ElementID=\"grid\" Duration=\"0\" Delay=\"0\" Visible=\"true\" />\n  </Instructions>\n</StuxnetAnimatedTheme>\n"},
            {"kind": "json", "label": "Stuxnet config (stuxnet_config.json)", "folder": "", "ext": ".json", "fixedPath": "stuxnet_config.json", "body": "{\n  \"showDebugText\": true,\n  \"enableMessageBoardFix\": true,\n  \"customCompIcons\": {},\n  \"audio\": {\n    \"replaceMusicManager\": true,\n    \"offsetLoopPoints\": true,\n    \"songs\": {}\n  },\n  \"quests\": {\n    \"replaceLoadMissionAction\": false,\n    \"ignoreXMODMissions\": false\n  },\n  \"sms\": {\n    \"authorColors\": {}\n  },\n  \"gamemode\": {\n    \"gamemodes\": [],\n    \"selectPathText\": \"\",\n    \"requirePersistentFlag\": \"\"\n  },\n  \"codeRedemption\": {\n    \"codes\": {},\n    \"customSplashText\": []\n  },\n  \"sequencers\": {},\n  \"achievements\": []\n}\n"},
        ],
        "tags": tags,
        "extraNodes": extra,
    }


# ---------------------------------------------------------------- ZeroDayToolKit

def zdtk():
    common_flags = {
        "requiredFlags": f("requiredFlags", "flags", "Only fire when the player has all these flags"),
        "doesNotHaveFlags": f("doesNotHaveFlags", "flags", "Only fire when the player has none of these flags"),
    }
    irc = {
        "target": f("target", "computer", "Computer with the IRC/DHS chat", compFilter=["IRCDaemon", "DHSDaemon"]),
        "user": f("user", "text", "Only messages from this user (#PLAYERNAME# for the player)", wildcards=True),
        "notUser": f("notUser", "text", "Ignore messages from this user"),
        "minDelay": f("minDelay", "text", "Seconds since ResetIRCDelay, at least"),
        "maxDelay": f("maxDelay", "text", "Seconds since ResetIRCDelay, at most"),
        **common_flags,
    }
    host = {
        **common_flags,
        "targetComp": f("targetComp", "computer", "Computer (default: the current one)"),
        "targetNetwork": f("targetNetwork", "name", "TraceV2 network name", ns="0dtk.network"),
    }
    commands = [{"value": c, "desc": ""} for c in (
        "alias", "unalias", "btoa", "atob", "binary", "cp", "date", "echo", "expr", "head", "tail", "history", "hostname", "last", "w", "man",
        "mkdir", "ping", "pwd", "radio", "rmdir", "send", "/", ">", "irc", "shutdown", "sleep", "source", "touch", "wc", "who", "whoami", "zip", "unzip", "netstat")]
    tags = {
        "SetRAM": {"desc": "Set the player's RAM", "group": "0DTK", "attrs": {"ram": f("ram", "text", "RAM in MB, e.g. 1200", required=True)}},
        "RunCommand": {"desc": "Run a terminal command", "group": "0DTK", "attrs": {"command": f("command", "text", "Command line", required=True)}},
        "ResetIRCDelay": {"desc": "Restart the IRC delay timer used by minDelay/maxDelay", "group": "0DTK · IRC", "attrs": {"target": f("target", "computer", "Computer with the IRC/DHS chat", required=True, compFilter=["IRCDaemon", "DHSDaemon"])}},
        "SetNumberOfChoices": {"desc": "Number of choices offered in an interactive IRC log", "group": "0DTK · IRC", "attrs": {"choices": f("choices", "text", "Number of choices", required=True)}},
        "DisableCommand": {"desc": "Disable a terminal command", "group": "0DTK", "attrs": {"command": f("command", "enum", "Command", required=True, enums=commands, diag="I")}},
        "EnableCommand": {"desc": "Enable a command (some 0DTK commands start disabled)", "group": "0DTK", "attrs": {"command": f("command", "enum", "Command", required=True, enums=commands, diag="I")}},
        "EnableStrictLog": {"desc": "This computer also logs connections; players must clean up and ForkBomb out", "group": "0DTK", "attrs": {"targetComp": f("targetComp", "computer", "Computer", required=True)}},
        "DisableStrictLog": {"desc": "Turn strict logging off", "group": "0DTK", "attrs": {"targetComp": f("targetComp", "computer", "Computer", required=True)}},
        "SendEvent": {"desc": "Send an event to every OnEvent listening for it", "group": "0DTK · Events", "attrs": {"signal": f("signal", "name", "Event name", ns="0dtk.event", define=True, required=True)}},
        "OnEvent": {"kind": "condition", "desc": "Runs when SendEvent sends this signal", "group": "0DTK · Events", "attrs": {"signal": f("signal", "name", "Event name", ns="0dtk.event", required=True), **common_flags}},
        "OnFileCreation": {"kind": "condition", "desc": "Runs when a matching file exists on a computer", "group": "0DTK", "attrs": {
            "target": f("target", "computer", "Computer", required=True), "path": f("path", "text", "Folder (empty: whole computer)"),
            "name": f("name", "text", "File name"), "content": f("content", "text", "File content")}},
        "OnFileDeletion": {"kind": "condition", "desc": "Runs when no matching file exists on a computer", "group": "0DTK", "attrs": {
            "target": f("target", "computer", "Computer", required=True), "path": f("path", "text", "Folder (empty: whole computer)"),
            "name": f("name", "text", "File name"), "content": f("content", "text", "File content")}},
        "OnIRCMessageAny": {"kind": "condition", "desc": "Runs on any IRC message", "group": "0DTK · IRC", "attrs": irc},
        "OnIRCMessage": {"kind": "condition", "desc": "Runs when a word is said on IRC (& = and, | = or)", "group": "0DTK · IRC", "attrs": {**irc, "word": f("word", "text", "Words, e.g. what&this|that", required=True)}},
        "OnIRCMessageTone": {"kind": "condition", "desc": "Runs when a reply has a tone (yes, no, help, 1-10…)", "group": "0DTK · IRC", "attrs": {**irc, "tone": f("tone", "name", "Tone", ns="0dtk.tone", required=True)}},
        "OnIRCAttachment": {"kind": "condition", "desc": "Runs when an attachment is posted", "group": "0DTK · IRC", "attrs": {**irc, "name": f("name", "text", "Attachment name")}},
        "OnIRCAttachmentLink": {"kind": "condition", "desc": "Runs when a link attachment is posted", "group": "0DTK · IRC", "attrs": {**irc, "name": f("name", "text", "Link name"), "ip": f("ip", "computerip", "IP")}},
        "OnIRCAttachmentAccount": {"kind": "condition", "desc": "Runs when an account attachment is posted", "group": "0DTK · IRC", "attrs": {**irc, "name": f("name", "text", "Name"), "ip": f("ip", "computerip", "IP"), "id": f("id", "text", "Username"), "password": f("password", "text", "Password")}},
        "OnIRCAttachmentFile": {"kind": "condition", "desc": "Runs when a file attachment is posted", "group": "0DTK · IRC", "attrs": {**irc, "name": f("name", "text", "File name"), "content": f("content", "text", "File content (hash data for images/executables)")}},
        "OnHostileActionTaken": {"kind": "condition", "desc": "Runs when a hostile action (hack attempt) is taken", "group": "0DTK · TraceV2", "attrs": host},
        "OnCrash": {"kind": "condition", "desc": "Runs when a computer or network head crashes", "group": "0DTK · TraceV2", "attrs": host},
        "OnReboot": {"kind": "condition", "desc": "Runs when a computer or network head reboots after a crash", "group": "0DTK · TraceV2", "attrs": host},
        "OnRebootCompleted": {"kind": "condition", "desc": "Runs when a network finishes its Retrace timer", "group": "0DTK · TraceV2", "attrs": {
            **common_flags, "targetNetwork": f("targetNetwork", "name", "TraceV2 network name", ns="0dtk.network"),
            "RequireLogsOnSource": f("RequireLogsOnSource", "bool", "Only if logs are left on the network"),
            "RequireSourceIntact": f("RequireSourceIntact", "bool", "Only if sys/netcfgx.dll is still on a device")}},
    }
    trig = lambda name, desc, extra=(): {"paths": [f"TraceV2.{name}"], "multi": False, "desc": desc, "attributes": [
        f("action", "actionfile", "Actions to load", required=True),
        f("DelayHost", "computer", "Delay host (default: the triggering computer)", compFilter=DELAY_HOSTS),
        f("Delay", "text", "Seconds"),
        f("RequireLogsOnSource", "bool", "Only if logs are left on the network"),
        f("RequireSourceIntact", "bool", "Only if sys/netcfgx.dll is still on a device"), *extra]}
    extra = [
        {"paths": ["TraceV2"], "multi": False, "container": True, "desc": "A 0DTK network: nodes that share a TraceV2 'Track' timer", "attributes": [
            f("name", "name", "Network name (used by targetNetwork)", ns="0dtk.network", define=True, required=True),
            f("head", "computer", "Head computer; crashing it starts Retrace", required=True)]},
        {"paths": ["TraceV2.trace"], "multi": False, "desc": "Track timer", "attributes": [f("time", "text", "Seconds", required=True)]},
        {"paths": ["TraceV2.reboot"], "multi": False, "desc": "Retrace timer", "attributes": [f("time", "text", "Seconds", required=True)]},
        {"paths": ["TraceV2.Computer"], "multi": True, "desc": "Member computer", "attributes": [f("name", "computer", "Computer ID", required=True)]},
        trig("onStart", "Actions when hostile activity is detected (OnHostileActionTaken)"),
        trig("onCrash", "Actions when the head crashes (OnCrash)"),
        trig("onComplete", "Actions when Retrace finishes (OnRebootCompleted)"),
        trig("afterComplete", "Actions every N connections after completion", [f("every", "text", "Every N connections"), f("offAfter", "text", "Stop after this many triggers (-1: never)")]),
        {"paths": ["Locale"], "multi": False, "container": True, "desc": "0DTK locale file (Locales/*.xml)", "attributes": []},
        {"paths": ["Locale.*"], "multi": True, "container": True, "desc": "Language (e.g. en-us, ko-kr)", "attributes": []},
        {"paths": ["Locale.*.l"], "multi": True, "desc": "Translation", "content": content("text", "Text"), "attributes": [
            f("key", "name", "Key, used as {{key}} in text", ns="0dtk.locale", define=True, required=True),
            f("exact", "bool", "Only replace whole matches")]},
    ]
    return {
        "id": "zerodaytoolkit",
        "name": "ZeroDayToolKit (0DTK)",
        "version": "1.0.x",
        "url": "https://github.com/prodzpod/ZeroDayToolKit",
        "description": "prodzpod's 'build-your-own community DLC': TraceV2 networks, IRC conversations, events, file conditions, new executables and locales.",
        "detect": {"plugins": "zerodaytoolkit|0dtk", "folders": ["Networks"], "roots": ["TraceV2"]},
        "executables": [
            {"value": "#SSH_SWIFT#", "desc": "SSHSwift: opens 22 (0DTK)"}, {"value": "#TELE_SMOOTH#", "desc": "teleSMOOTH: opens 23 (0DTK)"},
            {"value": "#PACKET_HEADER_INJECTION#", "desc": "pkthdr: opens 80 (0DTK)"}, {"value": "#SQL_TX_CRASHER#", "desc": "THE_LAST_RESORT: opens 1433 (0DTK)"},
            {"value": "#GIT_TUNNEL#", "desc": "GitTunnel: opens 9418 (0DTK)"}, {"value": "#PORT_BACKDOOR#", "desc": "PortBackdoor: opens port 0 (0DTK)"},
            {"value": "#0DTK_IMAGE:Images/file.png#", "desc": "Image file content (0DTK)"}, {"value": "#STUXNET_RADIO:songID#", "desc": "Audio file content (0DTK + Stuxnet)"}],
        "ports": [
            {"protocol": "backdoor", "name": "Backdoor Connection", "port": 0}, {"protocol": "telnet", "name": "Telnet", "port": 23},
            {"protocol": "ntp", "name": "Network Time Protocol", "port": 123}, {"protocol": "mqtt", "name": "MQTT", "port": 1883},
            {"protocol": "docker", "name": "Docker Plaintext API", "port": 2375}],
        "fileKinds": [
            {"root": "TraceV2", "kind": "network", "label": "TraceV2 network", "folder": "Networks", "icon": "◎"},
            {"root": "Locale", "kind": "locale", "label": "Locale", "folder": "Locales", "icon": "あ"},
        ],
        "enumExtensions": {
            "HacknetExtension.Language@": [{"value": "dynamic", "desc": "0DTK: choose the language at runtime from Locales/"}],
        },
        "names": {
            "0dtk.network": {"label": "TraceV2 network", "severity": "error", "source": "a TraceV2 file in Networks/"},
            "0dtk.event": {"label": "event", "severity": "warning", "source": "SendEvent"},
            "0dtk.tone": {"label": "IRC tone", "severity": "warning", "source": "0DTK's tones or a 0dtk::tone_<name> locale key",
                          "builtin": ["no", "yes", "help", "hey", *[str(i) for i in range(1, 11)]]},
            "0dtk.locale": {"label": "locale key", "severity": "info", "source": "Locales/*.xml (or Hacknet/locales/Custom)"},
        },
        "contentRefs": [
            {"pattern": "#0DTK_IMAGE:([^#]+)#", "kind": "file"},
            {"pattern": "!ATTACHMENT:image#%#[^#]*#%#([^\\s<#]+)", "kind": "file"},
            {"pattern": "#STUXNET_RADIO:([^#]+)#", "kind": "name", "ns": "stuxnet.song"},
            {"pattern": "\\{\\{([^{}\\s]+)\\}\\}", "kind": "name", "ns": "0dtk.locale"},
        ],
        "provider": "zdtkLocales",
        "templates": [
            {"kind": "network", "label": "0DTK TraceV2 network", "folder": "Networks", "ext": ".xml", "body": "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n<TraceV2 name=\"{{id}}\" head=\"\">\n  <trace time=\"600\" />\n  <reboot time=\"10\" />\n  <Computer name=\"\" />\n</TraceV2>\n"},
            {"kind": "locale", "label": "0DTK locale", "folder": "Locales", "ext": ".xml", "body": "<Locale>\n  <en-us>\n    <l key=\"hello\">Hello</l>\n  </en-us>\n</Locale>\n"},
        ],
        "tags": tags,
        "extraNodes": extra,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stuxnet", required=True)
    ap.add_argument("--zdtk", required=True)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, src, cur in (("stuxnet", a.stuxnet, stuxnet()), ("zerodaytoolkit", a.zdtk, zdtk())):
        mod = build(run_extractor(src), cur, name)
        (OUT / f"{name}.json").write_text(json.dumps(mod, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{name}: {len(mod['nodes'])} nodes")


if __name__ == "__main__":
    main()
