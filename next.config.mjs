const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
export default {
 output:'standalone', turbopack:{root:process.cwd()}, serverExternalPackages:['better-sqlite3','sharp'], poweredByHeader:false,
 async headers(){return [{source:'/icon.svg',headers:[{key:'Cache-Control',value:'public, max-age=86400, s-maxage=604800'}]},{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},{key:'Content-Security-Policy',value:csp},{key:'X-Frame-Options',value:'DENY'},{key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'}]}]}
};
