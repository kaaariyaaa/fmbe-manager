export const HELP_LANGUAGE_OPTIONS = ["English", "Japanese"] as const;

export const HELP_COMMAND_OPTIONS = [
  "new_block",
  "new_item",
  "list",
  "get",
  "set_preset",
  "set_block",
  "set_item",
  "set_location",
  "clone",
  "remove",
  "data",
  "group_create",
  "group_delete",
  "group_list",
  "group_info",
  "group_set",
  "group_clear",
  "group_move",
  "scoreboard",
  "help",
] as const;

type HelpLanguage = (typeof HELP_LANGUAGE_OPTIONS)[number];

function getEnglishHelpLines(command: string): string[] {
  switch (command) {
    case "new_block":
      return ["/fmbe:new_block block:<BlockType> preset:<2D|3D> ?location ?xOffset ?yOffset ?zOffset ?scale"];
    case "new_item":
      return ["/fmbe:new_item item:<ItemType> ?location ?xOffset ?yOffset ?zOffset ?scale"];
    case "list":
      return ["/fmbe:list ?preset:<Item|2D|3D>"];
    case "get":
      return [
        "/fmbe:get ?entity:<EntitySelector>",
        "If entity is omitted, run get first then hit an FMBE to inspect.",
      ];
    case "set_preset":
      return ["/fmbe:set_preset preset:<Item|2D|3D> entity:<EntitySelector>"];
    case "set_block":
      return ["/fmbe:set_block block:<BlockType> entity:<EntitySelector>"];
    case "set_item":
      return ["/fmbe:set_item item:<ItemType> entity:<EntitySelector>"];
    case "set_location":
      return ["/fmbe:set_location location:<Location> entity:<EntitySelector>"];
    case "clone":
      return ["/fmbe:clone fromEntity:<EntitySelector> ?toEntity:<EntitySelector> ?location:<Location>"];
    case "remove":
      return ["/fmbe:remove entity:<EntitySelector>"];
    case "data":
      return ["/fmbe:data content:<cleanup|fix|validate> ?entity:<EntitySelector>"];
    case "group_create":
      return ["/fmbe:group_create group:<String>"];
    case "group_delete":
      return ["/fmbe:group_delete group:<String>"];
    case "group_list":
      return ["/fmbe:group_list ?group:<String>"];
    case "group_info":
      return ["/fmbe:group_info group:<String>"];
    case "group_set":
      return ["/fmbe:group_set group:<String> entity:<EntitySelector>"];
    case "group_clear":
      return ["/fmbe:group_clear entity:<EntitySelector>"];
    case "group_move":
      return ["/fmbe:group_move entity:<EntitySelector> toGroup:<String>"];
    case "scoreboard":
      return [
        "Group shared values (dummy participant): fmbe:group:<groupName>",
        "Objectives (absolute): fmbe:group:xOffset, yOffset, zOffset, gxRot, gyRot, gzRot, gscl, gExtendScale, gExtendXrot, gExtendYrot, gExtendZrot, gxBasePos, gyBasePos, gzBasePos, LocationX, LocationY, LocationZ, Preset",
        "Value scale: floats are stored x1000 (e.g. 1.5 -> 1500)",
        "Relative operation objectives: fmbe:group:OpTarget, fmbe:group:OpType, fmbe:group:OpValue, fmbe:group:OpSeq",
        "OpTarget: 1:xOffset 2:yOffset 3:zOffset 4:xRot 5:yRot 6:zRot 7:scale 8:extendScale 9:extendXrot 10:extendYrot 11:extendZrot 12:xBasePos 13:yBasePos 14:zBasePos 15:x 16:y 17:z",
        "OpType: 1:add 2:sub 3:mul 4:div",
        "Apply relative op example (+0.5 xOffset for group teamA):",
        "scoreboard players set fmbe:group:teamA fmbe:group:OpTarget 1",
        "scoreboard players set fmbe:group:teamA fmbe:group:OpType 1",
        "scoreboard players set fmbe:group:teamA fmbe:group:OpValue 500",
        "scoreboard players add fmbe:group:teamA fmbe:group:OpSeq 1",
        "Note: reflected only when OpSeq changes.",
      ];
    case "help":
      return [
        "/fmbe:help language:<English|Japanese> command:<Enum>",
        `commands: ${HELP_COMMAND_OPTIONS.join(", ")}`,
      ];
    default:
      return ["unknown help command"];
  }
}

function getJapaneseHelpLines(command: string): string[] {
  switch (command) {
    case "new_block":
      return ["/fmbe:new_block block:<BlockType> preset:<2D|3D> ?location ?xOffset ?yOffset ?zOffset ?scale", "FMBEブロックを新規作成します"];
    case "new_item":
      return ["/fmbe:new_item item:<ItemType> ?location ?xOffset ?yOffset ?zOffset ?scale", "FMBEアイテムを新規作成します"];
    case "list":
      return ["/fmbe:list ?preset:<Item|2D|3D>", "FMBE一覧を表示します"];
    case "get":
      return [
        "/fmbe:get ?entity:<EntitySelector>",
        "対象FMBEの情報を表示します",
        "entity省略時はget実行後に最初に殴ったFMBEを表示します",
      ];
    case "set_preset":
      return ["/fmbe:set_preset preset:<Item|2D|3D> entity:<EntitySelector>", "対象FMBEのPresetを変更します"];
    case "set_block":
      return ["/fmbe:set_block block:<BlockType> entity:<EntitySelector>", "対象FMBEのBlockを変更します"];
    case "set_item":
      return ["/fmbe:set_item item:<ItemType> entity:<EntitySelector>", "対象FMBEのItemを変更します"];
    case "set_location":
      return ["/fmbe:set_location location:<Location> entity:<EntitySelector>", "対象FMBEの位置を変更します"];
    case "clone":
      return ["/fmbe:clone fromEntity:<EntitySelector> ?toEntity:<EntitySelector> ?location:<Location>", "FMBEを複製します"];
    case "remove":
      return ["/fmbe:remove entity:<EntitySelector>", "対象FMBEを削除します"];
    case "data":
      return ["/fmbe:data content:<cleanup|fix|validate> ?entity:<EntitySelector>", "データ整合性を処理します"];
    case "group_create":
      return ["/fmbe:group_create group:<String>", "グループを作成します"];
    case "group_delete":
      return ["/fmbe:group_delete group:<String>", "グループを削除します"];
    case "group_list":
      return ["/fmbe:group_list ?group:<String>", "グループ一覧またはメンバー一覧を表示します"];
    case "group_info":
      return ["/fmbe:group_info group:<String>", "グループ詳細を表示します"];
    case "group_set":
      return ["/fmbe:group_set group:<String> entity:<EntitySelector>", "FMBEをグループに所属させます"];
    case "group_clear":
      return ["/fmbe:group_clear entity:<EntitySelector>", "FMBEのグループ所属を解除します"];
    case "group_move":
      return ["/fmbe:group_move entity:<EntitySelector> toGroup:<String>", "FMBEを別グループへ移動します"];
    case "scoreboard":
      return [
        "グループ共有値のparticipant: fmbe:group:<groupName>",
        "絶対値objective: fmbe:group:xOffset, yOffset, zOffset, gxRot, gyRot, gzRot, gscl, gExtendScale, gExtendXrot, gExtendYrot, gExtendZrot, gxBasePos, gyBasePos, gzBasePos, LocationX, LocationY, LocationZ, Preset",
        "値スケール: 小数は1000倍で保存（例 1.5 -> 1500）",
        "相対演算objective: fmbe:group:OpTarget, fmbe:group:OpType, fmbe:group:OpValue, fmbe:group:OpSeq",
        "OpTarget: 1:xOffset 2:yOffset 3:zOffset 4:xRot 5:yRot 6:zRot 7:scale 8:extendScale 9:extendXrot 10:extendYrot 11:extendZrot 12:xBasePos 13:yBasePos 14:zBasePos 15:x 16:y 17:z",
        "OpType: 1:add 2:sub 3:mul 4:div",
        "相対演算例（group teamA の xOffset を +0.5）:",
        "scoreboard players set fmbe:group:teamA fmbe:group:OpTarget 1",
        "scoreboard players set fmbe:group:teamA fmbe:group:OpType 1",
        "scoreboard players set fmbe:group:teamA fmbe:group:OpValue 500",
        "scoreboard players add fmbe:group:teamA fmbe:group:OpSeq 1",
        "反映は OpSeq が変化した時のみです",
      ];
    case "help":
      return [
        "/fmbe:help language:<English|Japanese> command:<Enum>",
        `commands: ${HELP_COMMAND_OPTIONS.join(", ")}`,
      ];
    default:
      return ["不明なhelpコマンドです"];
  }
}

export function getHelpLines(language: string, command: string): string[] {
  const normalized = (language === "Japanese" ? "Japanese" : "English") as HelpLanguage;
  if (normalized === "Japanese") {
    return getJapaneseHelpLines(command);
  }
  return getEnglishHelpLines(command);
}
