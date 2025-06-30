// standaloneAPI.js
import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import LLMApiService from "../../services/llmApi.js";
import {PopupConfirm} from "../../components/popupConfirm.js";

let loadingToast = null;
let currentApiKeyIndex = 0;// 用于记录当前使用的API Key的索引

/**
 * 处理API密钥（移除加密，直接处理原始密钥）
 * @param {string} rawKey - 原始密钥
 * @returns {object} 处理结果
 */
export function processApiKey(rawKey) {
    try {
        const keys = rawKey.split(',').map(k => k.trim()).filter(k => k.trim().length > 0);
        const uniqueKeys = [...new Set(keys)];
        const processedKeyString = uniqueKeys.join(',');
        
        const invalidKeysCount = rawKey.split(',').length - keys.length; // 计算无效Key的数量
        const totalKeys = rawKey.split(',').length;
        const duplicatesRemoved = keys.length - uniqueKeys.length;
        const remainingKeys = uniqueKeys.length;

        let message = `已更新API Key，共${remainingKeys}个Key`;
        if(duplicatesRemoved > 0 || invalidKeysCount > 0){
            const removedParts = [];
            if (duplicatesRemoved > 0) removedParts.push(`${duplicatesRemoved}个重复Key`);
            if (invalidKeysCount > 0) removedParts.push(`${invalidKeysCount}个空值`);
            message += `（已去除${removedParts.join('，')}）`;
        }
        
        return {
            processedKey: processedKeyString,
            duplicatesRemoved: duplicatesRemoved,
            invalidKeysCount: invalidKeysCount,
            remainingKeys: remainingKeys,
            totalKeys: totalKeys,
            message: message,
        }
    } catch (error) {
        console.error('API Key 处理失败:', error);
        throw error;
    }
}

/**
 * 获取API密钥（直接返回存储的值）
 * @returns {string|null} API密钥字符串
 */
export function getDecryptedApiKey() {
    try {
        const apiKey = USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key;
        
        // 检查是否为旧版本的加密数据
        if (apiKey && isLegacyEncryptedData(apiKey)) {
            EDITOR.warning('检测到旧版本的加密API密钥，请重新设置您的API密钥以支持跨设备使用。');
            return null;
        }
        
        return apiKey || null;
    } catch (error) {
        console.error('获取API Key失败:', error);
        return null;
    }
}

/**
 * 检查是否为旧版本的加密数据
 * @param {string} data - 数据字符串
 * @returns {boolean} 是否为旧版本加密数据
 */
function isLegacyEncryptedData(data) {
    // 简单检测：如果字符串全是十六进制字符且长度较长，可能是加密数据
    const hexPattern = /^[0-9a-fA-F]+$/;
    return hexPattern.test(data) && data.length > 32 && !data.includes(',');
}

async function createLoadingToast(isUseMainAPI = true, isSilent = false) {
    if (isSilent) {
        // 在静默模式下，不显示弹窗，直接模拟"后台继续"
        // 返回 false，因为 PopupConfirm 中"后台继续"按钮（cancelBtn）返回 false
        return Promise.resolve(false);
    }
    loadingToast?.close()
    loadingToast = new PopupConfirm();
    return await loadingToast.show(
        isUseMainAPI
            ? '正在使用【主API】重新生成完整表格...'
            : '正在使用【自定义API】重新生成完整表格...',
        '后台继续',
        '中止执行',
    )
}

/**
 * 处理API测试请求
 * @param {string} apiUrl - API URL.
 * @param {string} apiKeys - API 密钥字符串.
 * @param {string} modelName - 模型名称.
 * @returns {Promise<Array<{keyIndex: number, success: boolean, error?: string}>>} 测试结果数组.
 */
export async function handleApiTestRequest(apiUrl, apiKeys, modelName) {
    if (!apiUrl || !apiKeys) {
        EDITOR.error('请先填写 API URL 和 API Key。');
        return [];
    }

    const apiKeysString = getDecryptedApiKey();
    if (!apiKeysString) {
        EDITOR.error('API Key 获取失败或未设置！');
        return [];
    }

    const apiKeyArray = apiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (apiKeyArray.length === 0) {
        EDITOR.error('未找到有效的 API Key。');
        return [];
    }
    
    const testAll = await EDITOR.callGenericPopup(`检测到 ${apiKeyArray.length} 个 API Key。\n注意：测试方式和酒馆自带的相同，将会发送一次消息（token数量很少），但如果使用的是按次计费的API请注意消费情况。`, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "测试第一个key", cancelButton: "取消" });
    let keysToTest = [];
    if (testAll === null) return [];

    if (testAll) {
        keysToTest = [apiKeyArray[0]];
        EDITOR.info(`开始测试第 ${keysToTest.length} 个 API Key...`);
    } else {
        return [];
    }

    try {
        const results = await testApiConnection(apiUrl, keysToTest, modelName);

        if (results && results.length > 0) {
            EDITOR.clear();
            let successCount = 0;
            let failureCount = 0;
            results.forEach(result => {
                if (result.success) {
                    successCount++;
                } else {
                    failureCount++;
                    console.error(`Key ${result.keyIndex !== undefined ? result.keyIndex + 1 : '?'} 测试失败: ${result.error}`);
                }
            });

            if (failureCount > 0) {
                EDITOR.error(`${failureCount} 个 Key 测试失败。请检查控制台获取详细信息。`);
                EDITOR.error(`API端点: ${apiUrl}`);
                EDITOR.error(`错误详情: ${results.find(r => !r.success)?.error || '未知错误'}`);
            }
            if (successCount > 0) {
                EDITOR.success(`${successCount} 个 Key 测试成功！`);
            }
        }

        return results;
    } catch (error) {
        EDITOR.error(`API 测试过程中发生错误: ${error.message}`);
        console.error("API Test Error:", error);
        return keysToTest.map((_, index) => ({
            keyIndex: apiKeyArray.indexOf(keysToTest[index]),
            success: false,
            error: `测试过程中发生错误: ${error.message}`
        }));
    }
}

/**
 * 测试API连接
 * @param {string} apiUrl - API URL
 * @param {string[]} apiKeys - API密钥数组
 * @param {string} modelName - 模型名称
 * @returns {Promise<Array<{keyIndex: number, success: boolean, error?: string}>>} 测试结果数组
 */
export async function testApiConnection(apiUrl, apiKeys, modelName) {
    const results = [];
    const testPrompt = "Say 'test'";

    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = apiKeys[i];
        console.log(`Testing API Key index: ${i}`);
        try {
            const llmService = new LLMApiService({
                api_url: apiUrl,
                api_key: apiKey,
                model_name: modelName || 'gpt-3.5-turbo',
                system_prompt: 'You are a test assistant.',
                temperature: 0.1
            });

            const response = await llmService.callLLM(testPrompt);

            if (response && typeof response === 'string') {
                console.log(`API Key index ${i} test successful. Response: ${response}`);
                results.push({ keyIndex: i, success: true });
            } else {
                throw new Error('Invalid or empty response received.');
            }
        } catch (error) {
            console.error(`API Key index ${i} test failed (raw error object):`, error);
            let errorMessage = 'Unknown error';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            } else if (error && typeof error.toString === 'function') {
                errorMessage = error.toString();
            }
            results.push({ keyIndex: i, success: false, error: errorMessage });
        }
    }
    return results;
}

/**自定义API调用
 * @param {string|Array<object>} systemPrompt - 系统提示或消息数组
 * @param {string} userPrompt - 用户提示
 * @param {boolean} isSilent - 是否静默模式
 * @param {boolean} isStream - 是否流式传输
 * @param {function} onDataCallback - 流式数据回调函数
 * @returns {Promise<string>} API响应
 */
export async function customApiCall(systemPrompt, userPrompt, isSilent = false, isStream = false, onDataCallback = null) {
    const USER_API_URL = USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url;
    const apiKeysString = getDecryptedApiKey(); // 直接获取API密钥
    const USER_API_MODEL = USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name;
    const MAX_RETRIES = 0;

    if (!USER_API_URL || !USER_API_MODEL) {
        EDITOR.error('请填写完整的自定义API配置 (URL 和模型)');
        return;
    }

    if (!apiKeysString) {
        EDITOR.error('API key获取失败或未设置，请检查API key设置！');
        return;
    }

    const apiKeys = apiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

    if (apiKeys.length === 0) {
        EDITOR.error('未找到有效的API Key，请检查输入。');
        return;
    }

    let suspended = false;
    createLoadingToast(false, isSilent).then((r) => {
        if (loadingToast) loadingToast.close();
        suspended = r;
    })

    const totalKeys = apiKeys.length;
    const attempts = MAX_RETRIES === 0 ? totalKeys : Math.min(MAX_RETRIES, totalKeys);
    let lastError = null;

    for (let i = 0; i < attempts; i++) {
        if (suspended) break;

        const keyIndexToTry = currentApiKeyIndex % totalKeys;
        const currentApiKey = apiKeys[keyIndexToTry];
        currentApiKeyIndex++;

        console.log(`尝试使用API密钥索引进行API调用: ${keyIndexToTry}`);
        if (loadingToast) {
            loadingToast.text = `尝试使用第 ${keyIndexToTry + 1}/${totalKeys} 个自定义API Key...`;
        }

        try {
            const promptData = Array.isArray(systemPrompt) ? systemPrompt : userPrompt;
            let response;

            console.log(`自定义API: 使用 llmService.callLLM (输入类型: ${Array.isArray(promptData) ? '多消息数组' : '单条消息'})`);

            const llmService = new LLMApiService({
                api_url: USER_API_URL,
                api_key: currentApiKey,
                model_name: USER_API_MODEL,
                system_prompt: Array.isArray(systemPrompt) ? '' : systemPrompt,
                temperature: USER.tableBaseSetting.custom_temperature || 0.7
            });

            if (Array.isArray(promptData)) {
                response = await llmService.callLLM(promptData, onDataCallback);
            } else {
                response = await llmService.callLLM(userPrompt, onDataCallback);
            }

            loadingToast?.close();
            console.log(`自定义API调用成功，使用密钥索引: ${keyIndexToTry}`);
            return response;

        } catch (llmServiceError) {
            console.error(`API调用失败 (llmService)，密钥索引 ${keyIndexToTry}:`, llmServiceError);
            lastError = llmServiceError;
            EDITOR.error(`使用第 ${keyIndexToTry + 1} 个 Key 调用 (llmService) 失败: ${llmServiceError.message || '未知错误'}`);
        }

        } catch (error) {
            console.error(`处理密钥索引 ${keyIndexToTry} 时发生意外错误:`, error);
            lastError = error;
            EDITOR.error(`处理第 ${keyIndexToTry + 1} 个 Key 时发生意外错误: ${error.message || '未知错误'}`);
        }
    }

    loadingToast?.close();
    if (suspended) {
        EDITOR.warning('操作已被用户中止。');
        return 'suspended';
    }

    const errorMessage = `所有 ${attempts} 次尝试均失败。最后错误: ${lastError?.message || '未知错误'}`;
    EDITOR.error(errorMessage);
    console.error('所有API调用尝试均失败。', lastError);
    return `错误: ${errorMessage}`;
}

// 其他可能需要的工具函数...
    // // 公共请求配置 (Commented out original code remains unchanged)
    // const requestConfig = {
    //     method: 'POST',
    //     headers: {
    //         'Content-Type': 'application/json',
    //         'Authorization': `Bearer ${USER_API_KEY}`
    //     },
    //     body: JSON.stringify({
    //         model: USER_API_MODEL,
    //         messages: [
    //             { role: "system", content: systemPrompt },
    //             { role: "user", content: userPrompt }
    //         ],
    //         temperature: USER.tableBaseSetting.custom_temperature
    //     })
    // };
    //
    // // 通用请求函数
    // const makeRequest = async (url) => {
    //     const response = await fetch(url, requestConfig);
    //     if (!response.ok) {
    //         const errorBody = await response.text();
    //         throw { status: response.status, message: errorBody };
    //     }
    //     return response.json();
    // };
    // let firstError;
    // try {
    //     // 第一次尝试补全/chat/completions
    //     const modifiedUrl = new URL(USER_API_URL);
    //     modifiedUrl.pathname = modifiedUrl.pathname.replace(/\/$/, '') + '/chat/completions';
    //     const result = await makeRequest(modifiedUrl.href);
    //     if (result?.choices?.[0]?.message?.content) {
    //         console.log('请求成功:', result.choices[0].message.content)
    //         return result.choices[0].message.content;
    //     }
    // } catch (error) {
    //     firstError = error;
    // }
    //
    // try {
    //     // 第二次尝试原始URL
    //     const result = await makeRequest(USER_API_URL);
    //     return result.choices[0].message.content;
    // } catch (secondError) {
    //     const combinedError = new Error('API请求失败');
    //     combinedError.details = {
    //         firstAttempt: firstError?.message || '第一次请求无错误信息',
    //         secondAttempt: secondError.message
    //     };
    //     throw combinedError;
    // }
}

/**请求模型列表
 * @returns {Promise<void>}
 */
/**
 * 格式化API Key用于错误提示
 * @param {string} key - API Key
 * @returns {string} 格式化后的Key字符串
 */
function maskApiKey(key) {
    const len = key.length;
    if (len === 0) return "[空密钥]";
    if (len <= 8) {
        const visibleCount = Math.ceil(len / 2);
        return key.substring(0, visibleCount) + '...';
    } else {
        return key.substring(0, 4) + '...' + key.substring(len - 4);
    }
}

/**请求模型列表
 * @returns {Promise<void>}
 */
export async function updateModelList() {
    const apiUrl = $('#custom_api_url').val().trim();
    const decryptedApiKeysString = await getDecryptedApiKey(); // 使用 getDecryptedApiKey 函数解密

    if (!decryptedApiKeysString) {
        EDITOR.error('API key解密失败或未设置，请检查API key设置！');
        return;
    }
    if (!apiUrl) {
        EDITOR.error('请输入API URL');
        return;
    }

    const apiKeys = decryptedApiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

    if (apiKeys.length === 0) {
        EDITOR.error('未找到有效的API Key，请检查输入。');
        return;
    }

    let foundValidKey = false;
    const invalidKeysInfo = [];
    let modelCount = 0; // 用于记录获取到的模型数量
    const $selector = $('#model_selector');

    // 规范化URL路径
    let modelsUrl;
    try {
        const normalizedUrl = new URL(apiUrl);
        normalizedUrl.pathname = normalizedUrl.pathname.replace(/\/$/, '') + '/models';
        modelsUrl = normalizedUrl.href;
    } catch (e) {
        EDITOR.error(`无效的API URL: ${apiUrl}`);
        console.error('URL解析失败:', e);
        return;
    }

    for (let i = 0; i < apiKeys.length; i++) {
        const currentApiKey = apiKeys[i];
        try {
            const response = await fetch(modelsUrl, {
                headers: {
                    'Authorization': `Bearer ${currentApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                let errorMsg = `请求失败: ${response.status}`;
                try {
                    const errorBody = await response.text();
                    errorMsg += ` - ${errorBody}`;
                } catch {}
                throw new Error(errorMsg);
            }

            const data = await response.json();

            // 只有在第一次成功获取时才更新下拉框
            if (!foundValidKey && data?.data?.length > 0) {
                $selector.empty(); // 清空现有选项
                const customModelName = USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name;
                let hasMatchedModel = false;

                data.data.forEach(model => {
                    $selector.append($('<option>', {
                        value: model.id,
                        text: model.id
                    }));

                    // 检查是否有模型名称与custom_model_name匹配
                    if (model.id === customModelName) {
                        hasMatchedModel = true;
                    }
                });

                // 如果有匹配的模型，则选中它
                if (hasMatchedModel) {
                    $selector.val(customModelName);
                }

                foundValidKey = true;
                modelCount = data.data.length; // 记录模型数量
                // 不在此处显示成功消息，统一在最后处理
            } else if (!foundValidKey && (!data?.data || data.data.length === 0)) {
                 // 即使请求成功，但没有模型数据，也视为一种失败情况，记录下来
                 throw new Error('请求成功但未返回有效模型列表');
            }
            // 如果已经找到有效key并更新了列表，后续的key只做有效性检查，不再更新UI

        } catch (error) {
            console.error(`使用第 ${i + 1} 个 Key 获取模型失败:`, error);
            invalidKeysInfo.push({ index: i + 1, key: currentApiKey, error: error.message });
        }
    }

    // 处理最终结果和错误提示
    if (foundValidKey) {
        EDITOR.success(`成功获取 ${modelCount} 个模型并更新列表 (共检查 ${apiKeys.length} 个Key)`);
    } else {
        EDITOR.error('未能使用任何提供的API Key获取模型列表');
        $selector.empty(); // 确保在所有key都无效时清空列表
        $selector.append($('<option>', { value: '', text: '未能获取模型列表' }));
    }

    if (invalidKeysInfo.length > 0) {
        const errorDetails = invalidKeysInfo.map(item =>
            `第${item.index}个Key (${maskApiKey(item.key)}) 无效: ${item.error}`
        ).join('\n');
        EDITOR.error(`以下API Key无效:\n${errorDetails}`);
    }
}
/**
 * 估算 Token 数量
 * @param {string} text - 要估算 token 数量的文本
 * @returns {number} 估算的 token 数量
 */
export function estimateTokenCount(text) {
    // 统计中文字符数量
    let chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;

    // 统计英文单词数量
    let englishWords = text.match(/\b\w+\b/g) || [];
    let englishCount = englishWords.length;

    // 估算 token 数量
    let estimatedTokenCount = chineseCount + Math.floor(englishCount * 1.2);
    return estimatedTokenCount;
}
/**
 * @description
 * - **功能**: 导出所有表格数据，方便其他插件调用。
 * - **使用场景**: 当其他插件需要访问或处理当前插件管理的表格数据时，可以通过此函数获取。
 * - **返回值**: 返回一个包含所有表格数据的数组，每个表格对象包含：
 *   - `name`: 表格的名称。
 *   - `data`: 一个二维数组，表示表格的完整数据（包括表头和所有行）。
 *
 * @returns {Array<Object<{name: string, data: Array<Array<string>>}>>}
 */
export function ext_getAllTables() {
    // 核心重构：与 ext_exportAllTablesAsJson 保持一致，确保数据源是最新的持久化状态。
    
    // 1. 获取最新的 piece
    const { piece } = BASE.getLastSheetsPiece();
    if (!piece || !piece.hash_sheets) {
        console.warn("[Memory Enhancement] ext_getAllTables: 未找到任何有效的表格数据。");
        return [];
    }

    // 2. 基于最新的 hash_sheets 创建/更新 Sheet 实例
    const tables = BASE.hashSheetsToSheets(piece.hash_sheets);
    if (!tables || tables.length === 0) {
        return [];
    }
    
    // 3. 遍历最新的实例构建数据
    const allData = tables.map(table => {
        if (!table.enable) return null; // 跳过禁用的表格
        const header = table.getHeader();
        const body = table.getBody();
        const fullData = [header, ...body];

        return {
            name: table.name,
            data: fullData,
        };
    }).filter(Boolean); // 过滤掉 null (禁用的表格)

    return allData;
}

/**
 * @description
 * - **功能**: 导出所有表格为一个 JSON 对象，格式与 '范例表格.json' 类似。
 * - **使用场景**: 用于将当前所有表格的状态和数据导出为一个单一的 JSON 文件。
 * - **返回值**: 返回一个 JSON 对象，键是表格的 UID，值是表格的完整配置和数据。
 *
 * @returns {Object}
 */
export function ext_exportAllTablesAsJson() {
    // 最终、最稳妥的方案：确保输入给 JSON.stringify 的数据是纯净的。

    const { piece } = BASE.getLastSheetsPiece();
    if (!piece || !piece.hash_sheets) {
        console.warn("[Memory Enhancement] ext_exportAllTablesAsJson: 未找到任何有效的表格数据。");
        return {};
    }

    const tables = BASE.hashSheetsToSheets(piece.hash_sheets);
    if (!tables || tables.length === 0) {
        return {};
    }

    const exportData = {};
    tables.forEach(table => {
        if (!table.enable) return; // 跳过禁用的表格

        try {
            const rawContent = table.getContent(true) || [];

            // 深度清洗，确保所有单元格都是字符串类型。
            // 这是防止因 undefined、null 或其他非字符串类型导致 JSON.stringify 行为异常的关键。
            const sanitizedContent = rawContent.map(row =>
                Array.isArray(row) ? row.map(cell =>
                    String(cell ?? '') // 将 null 和 undefined 转换为空字符串，其他类型强制转换为字符串
                ) : []
            );

            exportData[table.uid] = {
                uid: table.uid,
                name: table.name,
                content: sanitizedContent
            };
        } catch (error) {
            console.error(`[Memory Enhancement] 导出表格 ${table.name} (UID: ${table.uid}) 时出错:`, error);
        }
    });

    // 直接序列化整个清洗过的对象。
    // 如果这里依然出错，说明问题比预想的更复杂，但理论上这已经是JS中最标准的做法。
    try {
        // 为了避免外层宏解析失败，我们直接返回字符串，让宏自己去解析。
        return exportData;
    } catch (e) {
        console.error("[Memory Enhancement] 最终JSON序列化失败:", e);
        return {}; // 发生意外时返回空对象
    }
}
