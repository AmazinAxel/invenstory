// Node policy for workflows the LLM builds. Default-deny: a node type that is not listed
// here is refused. Lists need upkeep as connectors are added (see plan, Known risks).

const B = 'n8n-nodes-base.';
const L = '@n8n/n8n-nodes-langchain.';

/** Flow, transform, trigger, data-table and LLM nodes: always allowed (Code/HTTP/sub-workflow are checked separately). */
export const CORE_NODES = new Set<string>([
  ...[
    'set', 'if', 'switch', 'filter', 'merge', 'splitOut', 'aggregate', 'summarize', 'sort', 'limit', 'removeDuplicates',
    'dateTime', 'splitInBatches', 'noOp', 'wait', 'compareDatasets', 'renameKeys', 'itemLists', 'crypto', 'xml', 'html',
    'markdown', 'convertToFile', 'extractFromFile', 'dataTable', 'executeWorkflowTrigger', 'manualTrigger', 'scheduleTrigger',
    'webhook', 'respondToWebhook', 'stickyNote', 'errorTrigger', 'formTrigger', 'form', 'stopAndError', 'executionData',
    'interval', 'cron', 'spreadsheetFile', 'readBinaryFile', 'moveBinaryData', 'jsonParse',
  ].map((n) => B + n),
  ...[
    'chainLlm', 'chainSummarization', 'informationExtractor', 'textClassifier', 'sentimentAnalysis', 'agent',
    'outputParserStructured', 'outputParserAutofixing', 'outputParserItemList', 'memoryBufferWindow', 'toolCalculator',
    'toolThink', 'lmChatAnthropic', 'lmChatOpenAi', 'lmChatGoogleGemini', 'lmChatOpenRouter', 'lmChatGroq', 'lmChatXAiGrok',
    'lmChatMistralCloud', 'lmChatDeepSeek', 'lmChatOllama', 'lmChatAzureOpenAi', 'lmChatAwsBedrock', 'lmChatGoogleVertex',
    'lmOpenAi', 'embeddingsOpenAi', 'embeddingsGoogleGemini', 'textSplitterRecursiveCharacterTextSplitter',
    'documentDefaultDataLoader', 'vectorStoreInMemory', 'chatTrigger',
  ].map((n) => L + n),
]);

/** Business systems: reads and writes allowed, except operations that send/message. */
export const BUSINESS_NODES = new Set<string>(
  [
    'googleSheets', 'airtable', 'shopify', 'wooCommerce', 'notion', 'postgres', 'mySql', 'microsoftSql', 'mongoDb', 'supabase',
    'baserow', 'nocoDb', 'seaTable', 'grist', 'stripe', 'quickbooks', 'xero', 'zohoCrm', 'salesforce', 'pipedrive', 'hubspot',
    'googleDrive', 'dropbox', 'awsS3', 's3', 'ftp', 'microsoftExcel', 'microsoftOneDrive', 'odoo', 'magento2', 'paypal',
    'bigCommerce', 'squarespace', 'gumroad', 'chargebee', 'paddle', 'invoiceNinja', 'freshbooks', 'harvest', 'mondayCom',
    'clickUp', 'asana', 'trello', 'coda', 'smartsheet', 'redis', 'elasticsearch', 'googleBigQuery', 'snowflake', 'lemonSqueezy',
  ].flatMap((n) => [B + n, B + n + 'Trigger']),
);

/** Messaging / email systems: triggers and read operations only. */
export const MESSAGING_NODES = new Set<string>(
  [
    'gmail', 'microsoftOutlook', 'emailSend', 'emailReadImap', 'slack', 'telegram', 'discord', 'whatsApp', 'twilio', 'mailchimp',
    'sendGrid', 'mailgun', 'mattermost', 'microsoftTeams', 'googleChat', 'mailjet', 'sms77', 'vonage', 'messageBird', 'plivo',
    'pushover', 'matrix', 'line', 'rocketchat', 'zulip', 'brevo', 'sendInBlue', 'postmark', 'mautic', 'activeCampaign',
    'convertKit', 'klaviyo', 'intercom', 'zendesk', 'freshdesk', 'helpScout', 'facebookGraphApi', 'twitter', 'linkedIn',
  ].flatMap((n) => [B + n, B + n + 'Trigger']),
);

/** Always refused, even though n8n ships them: they reach the network or the instance freely. */
export const REFUSED_NODES = new Set<string>([
  B + 'executeCommand', B + 'ssh', B + 'n8n', B + 'function', B + 'functionItem', L + 'mcpClientTool', L + 'mcpClient',
  L + 'toolHttpRequest', B + 'graphql', B + 'awsLambda', B + 'emailSend',
]);

/** Operations on business nodes that would send something to a person. */
export const SEND_VERB = /(send|message|email|e-mail|sms|notify|notification|invite|reply|forward|tweet|broadcast|publish|campaign|dial|call)/i;

/** Operations that only read. */
export const READ_VERB = /^(get|getAll|getMany|list|search|read|lookup|find|fetch|download|count|exists)/i;

/** Code that could reach the network or load modules. */
export const CODE_NETWORK = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /^\s*import\s/m,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /\bhelpers\s*\.\s*(httpRequest|request|httpRequestWithAuthentication|requestWithAuthentication)/,
  /\$http\b/,
  /\baxios\b/,
  /\bprocess\s*\./,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bglobalThis\b/,
  /^\s*(from\s+\S+\s+)?import\s+(requests|urllib|http|socket|subprocess|os)\b/m,
];

/** Core workflows an LLM-built workflow may call without gating them again. */
export const CALLABLE_CORE = ['analyze', 'notify'] as const;
