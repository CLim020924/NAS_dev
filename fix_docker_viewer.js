const fs = require('fs');

// 1. 프론트엔드 패치 (FileViewer.js)
const frontFile = './frontend/src/components/NAS/FileViewer.js';
let frontCode = fs.readFileSync(frontFile, 'utf8');
const frontTarget = "const absoluteUrl = `${window.location.origin}${url}&oosecret=nas_office_2026`;";
const frontReplace = "const absoluteUrl = `${window.location.origin}${url}&oosecret=nas_office_2026&officeUid=${currentUser.id || ''}&officeRoot=${encodeURIComponent(currentUser.rootPath || '')}&officeAdmin=${isAdmin ? 'true' : 'false'}`;";

if (frontCode.includes(frontTarget)) {
    frontCode = frontCode.replace(frontTarget, frontReplace);
    fs.writeFileSync(frontFile, frontCode);
    console.log("✅ [프론트엔드] 도커 뷰어에게 유저 정보(경로) 챙겨주기 완료!");
} else {
    console.log("✅ [프론트엔드] 이미 패치되어 있습니다.");
}

// 2. 백엔드 패치 (nasRoutes.js)
const backFile = './backend/nasRoutes.js';
let backCode = fs.readFileSync(backFile, 'utf8');
const backTargetRegex = /if\s*\(\s*req\.query\.oosecret\s*===\s*'nas_office_2026'\s*\)\s*\{[\s\S]*?return\s+next\(\);\s*\}/;
const backReplace = `if (req.query.oosecret === 'nas_office_2026') {
    req.user = { 
        id: req.query.officeUid || 'office',
        Masters: req.query.officeAdmin === 'true',
        globalAccess: req.query.officeAdmin === 'true',
        rootPath: req.query.officeRoot || ''
    };
    return next();
}`;

if (backTargetRegex.test(backCode)) {
    backCode = backCode.replace(backTargetRegex, backReplace);
    fs.writeFileSync(backFile, backCode);
    console.log("✅ [백엔드] 문지기가 도커 뷰어의 유저 정보를 인식하도록 교육 완료!");
}
