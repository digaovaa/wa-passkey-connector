window.__waWebSessionDump = async () => {
    function bytesToB64(bytes) {
        if (!bytes) return null
        let u
        if (bytes instanceof Uint8Array) u = bytes
        else if (bytes instanceof ArrayBuffer) u = new Uint8Array(bytes)
        else if (typeof bytes === 'string') {
            
            
            u = Uint8Array.from(bytes, (c) => c.charCodeAt(0))
        } else return null
        const chunks = []
        const STEP = 0x8000
        for (let i = 0; i < u.length; i += STEP) {
            chunks.push(String.fromCharCode.apply(null, u.subarray(i, i + STEP)))
        }
        return btoa(chunks.join(''))
    }

    function bufWrap(bytes) {
        const b = bytesToB64(bytes)
        return b == null ? null : { type: 'Buffer', data: b }
    }

        function deepBufWrap(value) {
        if (value == null) return value
        if (value instanceof Uint8Array || value instanceof ArrayBuffer) return bufWrap(value)
        if (Array.isArray(value)) return value.map(deepBufWrap)
        if (typeof value === 'object') {
            
            const out = {}
            for (const k of Object.keys(value)) {
                if (k === '$$unknownFieldCount') continue
                out[k] = deepBufWrap(value[k])
            }
            return out
        }
        return value
    }

    function open(name) {
        return new Promise((res, rej) => {
            const req = indexedDB.open(name)
            req.onsuccess = () => res(req.result)
            req.onerror = () => rej(req.error)
        })
    }

    function getAll(db, store) {
        return new Promise((res, rej) => {
            const tx = db.transaction(store, 'readonly')
            const req = tx.objectStore(store).getAll()
            req.onsuccess = () => res(req.result)
            req.onerror = () => rej(req.error)
        })
    }

        async function decryptRegMaterial(obj) {
        if (!obj || !obj.encKey || !obj.value) return null
        const counter = new Uint8Array(16)
        const ct = obj.value instanceof Uint8Array ? obj.value : new Uint8Array(obj.value)
        const out = await crypto.subtle.decrypt(
            { name: 'AES-CTR', length: 128, counter },
            obj.encKey,
            ct
        )
        return new Uint8Array(out)
    }

        function getWaModule(name) {
        
        try {
            if (typeof require === 'function') return require(name)
        } catch {}
        
        
        try {
            if (typeof __d === 'function') {
                let captured
                const sentinel = '__waDumpProbe_' + Math.random().toString(36).slice(2)
                __d(sentinel, [name], function (_t, _n, _r, _o) {
                    captured = _o(name)
                })
                
                
                if (typeof __d.require === 'function') {
                    captured = captured ?? __d.require(name)
                }
                if (captured) return captured
            }
        } catch {}
        return null
    }

    async function getNoiseInfoViaInternalModule() {
        const infoStore = getWaModule('WAWebUserPrefsInfoStore')
        if (!infoStore?.waNoiseInfo?.get) return null
        try {
            const decrypted = await infoStore.waNoiseInfo.get()
            if (!decrypted?.staticKeyPair) return null
            return {
                pubKey: new Uint8Array(decrypted.staticKeyPair.pubKey),
                privKey: new Uint8Array(decrypted.staticKeyPair.privKey)
            }
        } catch (e) {
            console.warn('[wa-web-dump] internal module getNoiseInfo failed:', e)
            return null
        }
    }

        async function getNoiseInfoFallback() {
        const saltJson = localStorage.getItem('WAWebEncKeySalt')
        const noiseJson = localStorage.getItem('WANoiseInfo')
        const ivJson = localStorage.getItem('WANoiseInfoIv')
        if (!saltJson || !noiseJson || !ivJson) return null

        const saltBytes = Uint8Array.from(atob(JSON.parse(saltJson)), (c) => c.charCodeAt(0))
        const noiseObj = JSON.parse(noiseJson)
        const ivs = JSON.parse(ivJson).map((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))
        const encPub = Uint8Array.from(atob(noiseObj.pubKey), (c) => c.charCodeAt(0))
        const encPriv = Uint8Array.from(atob(noiseObj.privKey), (c) => c.charCodeAt(0))

        const dbEnc = await open('wawc_db_enc')
        const baseRows = await getAll(dbEnc, 'keys')
        dbEnc.close()
        if (!baseRows?.length) return null

        for (const row of baseRows) {
            const baseKey = row.key
            
            
            const candidateInfos = [new Uint8Array(1)]
            for (const info of candidateInfos) {
                try {
                    const aesKey = await crypto.subtle.deriveKey(
                        { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info },
                        baseKey,
                        { name: 'AES-CBC', length: 128 },
                        false,
                        ['decrypt']
                    )
                    const pub = await crypto.subtle.decrypt(
                        { name: 'AES-CBC', iv: ivs[1] },
                        aesKey,
                        encPub
                    )
                    const priv = await crypto.subtle.decrypt(
                        { name: 'AES-CBC', iv: ivs[2] },
                        aesKey,
                        encPriv
                    )
                    return { pubKey: new Uint8Array(pub), privKey: new Uint8Array(priv) }
                } catch {
                                    }
            }
        }
        return null
    }

    async function getNoiseKey() {
        const viaModule = await getNoiseInfoViaInternalModule()
        if (viaModule) {
            console.log('[wa-web-dump] noise key obtained via WAWebUserPrefsInfoStore (decrypted)')
            return viaModule
        }
        const viaFallback = await getNoiseInfoFallback()
        if (viaFallback) {
            console.log(
                '[wa-web-dump] noise key obtained via fallback HKDF (placeholder info path)'
            )
            return viaFallback
        }
        console.warn(
            '[wa-web-dump] FAILED to obtain noise key. Internal module access did not work and the fallback can only decrypt unrotated bootstrap state.\n' +
                'If you need the noise key, paste this dumper BEFORE the wa-web app fully completes its first login (no `success` stanza yet) - but typically you want a logged-in tab, where the internal-module path is the right one.\n' +
                'Continuing without noiseKey; baileys will need a re-pair to fill it in.'
        )
        return null
    }

    function parseAddress(addr) {
        
        
        
        const dot = addr.lastIndexOf('.')
        const head = dot >= 0 ? addr.slice(0, dot) : addr
        const device = dot >= 0 ? Number(addr.slice(dot + 1)) : 0
        
        
        const jid = head.includes('@') ? head : head + '@s.whatsapp.net'
        return { jid, device: Number.isFinite(device) ? device : 0 }
    }

    function parseSenderKeyName(name) {
        
        const sep = name.indexOf('::')
        if (sep < 0) return null
        const groupId = name.slice(0, sep)
        const senderPart = name.slice(sep + 2)
        const { jid, device } = parseAddress(senderPart)
        return { groupId, senderJid: jid, senderDevice: device }
    }

        async function getModelTable(schemaModuleName, tableGetterName) {
        const mod = getWaModule(schemaModuleName)
        const getter = mod?.[tableGetterName]
        if (typeof getter !== 'function') return []
        try {
            const rows = await getter().all()
            return Array.isArray(rows) ? rows : []
        } catch (e) {
            console.warn(`[wa-web-dump] ${schemaModuleName}.${tableGetterName}().all() failed:`, e)
            return []
        }
    }

    function toUint8(v) {
        if (v == null) return null
        if (v instanceof Uint8Array) return v
        if (v instanceof ArrayBuffer) return new Uint8Array(v)
        if (typeof v === 'object' && v.buffer instanceof ArrayBuffer) {
            return new Uint8Array(v.buffer, v.byteOffset ?? 0, v.byteLength ?? v.buffer.byteLength)
        }
        if (typeof v === 'string') {
            return Uint8Array.from(v, (c) => c.charCodeAt(0))
        }
        return null
    }

    

    const sg = await open('signal-storage')

    const [meta, identity, prekey, signedPrekey, session, senderkey] = await Promise.all([
        getAll(sg, 'signal-meta-store'),
        getAll(sg, 'identity-store'),
        getAll(sg, 'prekey-store'),
        getAll(sg, 'signed-prekey-store'),
        getAll(sg, 'session-store'),
        getAll(sg, 'senderkey-store')
    ])
    sg.close()

    const metaMap = {}
    for (const r of meta) metaMap[r.key] = r.value

    
    
    const staticPub = await decryptRegMaterial(metaMap.signal_static_pubkey)
    const staticPriv = await decryptRegMaterial(metaMap.signal_static_privkey)

    
    const noise = await getNoiseKey()

    
    
    const advSignedIdentity = metaMap.adv_signed_identity
        ? deepBufWrap(metaMap.adv_signed_identity)
        : null

    
    
    
    
    
    
    
    
    
    
    const [contactRows, tcTokenRows, userPrefsRows] = await Promise.all([
        getModelTable('WAWebSchemaContact_DO_NOT_USE_DIRECTLY', 'getContactTable'),
        getModelTable('WAWebSchemaOrphanTcToken', 'getOrphanTcTokenTable'),
        getModelTable('WAWebSchemaUserPrefs', 'getUserPrefsTable')
    ])

    
    
    
    
    const userPrefs = {}
    for (const row of userPrefsRows) {
        if (row?.key) userPrefs[String(row.key)] = row.value
    }

    
    
    
    if (userPrefsRows.length === 0) {
        try {
            const ms = await open('model-storage')
            if (ms.objectStoreNames.contains('user-prefs')) {
                const rows = await getAll(ms, 'user-prefs')
                for (const row of rows) {
                    if (row?.key) userPrefs[String(row.key)] = row.value
                }
                console.log(`[wa-web-dump] user-prefs raw fallback read ${rows.length} rows`)
            }
            ms.close()
        } catch (e) {
            console.warn('[wa-web-dump] user-prefs raw fallback failed:', e)
        }
    }

    
    
    
    
    
    
    
    
    
    
    let advSecretKey = null
    try {
        const v = await getWaModule('WAWebUserPrefsMultiDevice')?.getADVSecretKey?.()
        if (typeof v === 'string') advSecretKey = Uint8Array.from(atob(v), (c) => c.charCodeAt(0))
        else if (v) advSecretKey = toUint8(v)
    } catch {}
    if (!advSecretKey) {
        console.log(
            '[wa-web-dump] advSecretKey not available - wa-web wipes it post-pairing. ' +
                'Session will still migrate correctly; only future re-pair operations would need it.'
        )
    }

    
    
    
    const contacts = contactRows
        .map((r) => {
            if (!r.id) return null
            const out = { jid: String(r.id) }
            if (r.name) out.displayName = String(r.name)
            if (r.pushname) out.pushName = String(r.pushname)
            if (r.verifiedName) out.verifiedName = String(r.verifiedName)
            if (r.phoneNumber) out.phoneNumber = String(r.phoneNumber)
            return out
        })
        .filter(Boolean)

    
    const privacyTokens = tcTokenRows
        .map((r) => {
            if (!r.chatId) return null
            const token = toUint8(r.tcToken)
            if (!token) return null
            return {
                jid: String(r.chatId),
                token: bufWrap(token),
                timestampMs: (r.tcTokenTimestamp ?? 0) * 1000
            }
        })
        .filter(Boolean)

    const lastWidMd = (() => {
        try {
            return JSON.parse(localStorage.getItem('last-wid-md') ?? 'null')
        } catch {
            return null
        }
    })()
    const lid = (() => {
        try {
            return JSON.parse(localStorage.getItem('WALid') ?? 'null')
        } catch {
            return null
        }
    })()
    const meDisplayNameRaw = (() => {
        const raw = localStorage.getItem('me-display-name')
        if (raw == null) return null
        try {
            const parsed = JSON.parse(raw)
            if (typeof parsed === 'string') return parsed
            return parsed == null ? null : String(parsed)
        } catch {


            return raw || null
        }
    })()




    function bareWaUser(id) {
        if (!id || typeof id !== 'string') return ''
        return id.split('@')[0].split(':')[0].split('.')[0].split('_')[0]
    }
    const selfContactName = (() => {
        const targets = [bareWaUser(lastWidMd), bareWaUser(lid)].filter(Boolean)
        if (!targets.length) return null
        for (const c of contacts) {
            if (!targets.includes(bareWaUser(c.jid))) continue
            const n = c.verifiedName || c.pushName || c.displayName
            if (n) return String(n)
        }
        return null
    })()

    const meDisplayName = meDisplayNameRaw || selfContactName || null

    function widToJid(wid) {
        if (!wid || typeof wid !== 'string') return null
        
        
        const at = wid.lastIndexOf('@')
        const head = at >= 0 ? wid.slice(0, at) : wid
        const server = at >= 0 ? wid.slice(at + 1) : 's.whatsapp.net'
        const colon = head.indexOf(':')
        const userAndAgent = colon >= 0 ? head.slice(0, colon) : head
        const device = colon >= 0 ? Number(head.slice(colon + 1)) : 0
        const dot = userAndAgent.indexOf('.')
        const user = dot >= 0 ? userAndAgent.slice(0, dot) : userAndAgent
        return `${user}:${device}@${server}`
    }

    const dump = {
        device: {
            registrationId: metaMap.signal_reg_id ?? null,
            noiseKey: noise
                ? { pubKey: bufWrap(noise.pubKey), privKey: bufWrap(noise.privKey) }
                : null,
            identityKey:
                staticPub && staticPriv
                    ? { pubKey: bufWrap(staticPub), privKey: bufWrap(staticPriv) }
                    : null,
            signedPreKey: signedPrekey[signedPrekey.length - 1]
                ? {
                      keyId: signedPrekey[signedPrekey.length - 1].keyId,
                      keyPair: {
                          pubKey: bufWrap(signedPrekey[signedPrekey.length - 1].keyPair.pubKey),
                          privKey: bufWrap(signedPrekey[signedPrekey.length - 1].keyPair.privKey)
                      },
                      signature: bufWrap(signedPrekey[signedPrekey.length - 1].signature)
                  }
                : null,
            advSecretKey: advSecretKey ? bufWrap(advSecretKey) : bufWrap(new Uint8Array(0)),
            
            
            
            
            account: advSignedIdentity,
            meJid: widToJid(lastWidMd),
            meLid: widToJid(lid),
            meDisplayName: meDisplayName ?? null,
            platform: 'web'
        },
        preKeys: prekey.map((r) => ({
            keyId: r.keyId,
            keyPair: { pubKey: bufWrap(r.keyPair.pubKey), privKey: bufWrap(r.keyPair.privKey) }
        })),
        identities: identity.map((r) => {
            const { jid, device } = parseAddress(r.identifier)
            return { jid, device, identityKey: bufWrap(r.identityKey) }
        }),
        
        
        
        sessions: session.map((r) => {
            const { jid, device } = parseAddress(r.address)
            return { jid, device, session: deepBufWrap(r.session) }
        }),
        senderKeys: senderkey
            .map((r) => {
                const parsed = parseSenderKeyName(r.senderKeyName)
                if (!parsed) return null
                return {
                    groupId: parsed.groupId,
                    senderJid: parsed.senderJid,
                    senderDevice: parsed.senderDevice,
                    record: deepBufWrap(r.senderKey)
                }
            })
            .filter(Boolean),
        privacyTokens,
        contacts
    }

    console.log('[wa-web-dump] summary:', {
        regId: dump.device.registrationId,
        meJid: dump.device.meJid,
        meLid: dump.device.meLid,
        meDisplayName: dump.device.meDisplayName,
        meDisplayNameSource: meDisplayNameRaw
            ? 'localStorage'
            : selfContactName
              ? 'self-contact'
              : 'none',
        hasNoiseKey: !!dump.device.noiseKey,
        hasIdentityKey: !!dump.device.identityKey,
        hasSignedPreKey: !!dump.device.signedPreKey,
        preKeys: dump.preKeys.length,
        sessions: dump.sessions.length,
        senderKeys: dump.senderKeys.length,
        identities: dump.identities.length,
        privacyTokens: dump.privacyTokens.length,
        contacts: dump.contacts.length
    })

    if (!dump.device.noiseKey) {
        console.warn(
            '[wa-web-dump] noiseKey is null - baileys will not be able to resume the Noise XX handshake.\n' +
                'Workaround: re-pair the destination as a fresh companion (you keep the libsignal identity + sessions, only the noise transport key gets rotated).'
        )
    }

    return dump
}
