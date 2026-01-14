export type ClientType = {
    key: string;
    name: string;
    sector: string | null;
    image: string | null;
  };
  
  
  export type CreatedClient = {
    uuid: string;
    createdAt: string;
    hebrewName: string;
    englishName: string;
    sector: string;
    languages: string[];
    answerMinWordsLength: number | null;
    answerMaxWordsLength: number | null;
    emoji: boolean;
    intendedUsers: string;
  };
  
  export type CreateClientRequest = {
    hebrewName: string;
    englishName: string;
    sector: string;
    languages?: string[];
    answerMinWordsLength?: number|null;
    answerMaxWordsLength?: number|null;
    emoji?: boolean;
    imageBytes: string;
    intendedUsers: string;
  };
  
  export type UserRow = {
    UserUuid: string;
    ClientUuid: string;
    ClientName: string;
    userName: string;
    userNickName: string;
  };
  
  export type ChangeCurrentClientResponse = {
    ok: boolean;
    user: UserRow;
  };
  
  export type OrgType = {
    hebrewName: string;
    userHebrewName: string;
    userNickName: string;
    imageBase64?: string;
  };
  
  export type ChangeClientRequest = {
    toClientUuid: string;
  };
  
  
  export type GetClientType = {
    userHebrewName: string;
    userNickName: string;
    clientUuid: string;
    hebrewName: string;
    englishName: string;
    sector: string;
    createdAt: string;
    languages: string[];
    intendedUsers: string | null;
    answerMinWordsLength: number | null;
    answerMaxWordsLength: number | null;
    emoji: boolean;
    imageBase64: string;
  };
  
  export type DeleteFirstClientResponse = {
    message: string;
    reassignedUser: {
      userUuid: string;
      toClientUuid: string;
      toClientName: string;
    };
    deletedClientUuid: string | null | undefined;
  };
  
  
  export type ChangeClientDataRequest = {
    clientUuid: string;
    hebrewName?: string;
    englishName?: string;
    sector?: string;
    languages?: string[];
    answerMinWordsLength?: number | null;
    answerMaxWordsLength?: number | null;
    emoji?: boolean;
    intendedUsers?: string | null;
    imageBytes?: string | { type: "Buffer"; data: number[] } | null;
  };
  
  export type FileTypeEnum =
    | "png"
    | "jpg"
    | "jpeg"
    | "pdf"
    | "docs"
    | "excel"
    | "json"
    | "allfiles"
    | "json_topic";
  
  export type UploadFileRequest = {
    fileName: string;
    fileType: FileTypeEnum;
    mimeType: string;
    fileBytes: string;
    tag?: string | null;
    tags?: string[];
  };
  
  export type UploadedFileRecord = {
    fileUuid: string;
    fileName: string;
    fileType: FileTypeEnum;
    mimeType: string;
    tag: string | null;
    tags: string[];
    userUuid: string | null;
    clientUuid: string | null;
    sizeBytes: number;
    checksumSha256: string | null;
    createdAt: string;
    updatedAt: string;
  };
  
  export type UploadFileResponse = {
    file: UploadedFileRecord;
  };
  
  export type GetAllFilesResponse = {
    files: Array<{
      fileUuid: string;
      fileName: string;
      fileType: string;
      mimeType: string;
      tag: string | null;
      tags: string[];
      userUuid: string | null;
      clientUuid: string | null;
      sizeBytes: number;
      checksumSha256: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  
  export type PromptPostPayload = {
    promptText?: string;
    version?: number | string;
    model?: string | null;
    temperature?: number | string;
    topP?: number | string;
    notes?: string;
  };
  
  export type PromptRow = {
    promptUuid: string;
    clientUuid: string;
    promptText: string;
    version: number;
    model: string | null;
    temperature: number | null;
    topP: number | null;
    notes?: string;
    createdAt: string;
    updatedAt: string;
  };