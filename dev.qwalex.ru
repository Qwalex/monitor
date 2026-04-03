# Карта для WebSocket соединений
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    server_name dev.qwalex.ru;

    # Для Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri $uri/ =404;
    }

    # редирект без слэша
    location = /dozzle { return 301 https://$host/dozzle/; }

    # прокси с сохранением префикса /dozzle
    location ^~ /dozzle/ {
        auth_basic "Restricted Access";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:3007;  # без завершающего /
        proxy_http_version 1.1;

        proxy_set_header X-Forwarded-Prefix /dozzle;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;

        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    # прокси для gift-api на порт 3001
    location ^~ /gift-api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;

        proxy_set_header X-Forwarded-Prefix /gift-api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;

        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    # прокси для notify на порт 5656
    location ^~ /notify/ {
        proxy_pass http://127.0.0.1:5656/;
        proxy_http_version 1.1;

        proxy_set_header X-Forwarded-Prefix /notify;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;

        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    # прокси для notify на порт 5656
    location ^~ /bb/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;

        proxy_set_header X-Forwarded-Prefix /bb;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;

        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    # API за префиксом /api
    location ^~ /trade-api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-Prefix /trade-api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    # прокси для trade на порт 3003 (без автодобавления/срезания слэша)
    location ^~ /trade {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;

        # proxy_set_header X-Forwarded-Prefix /trade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;

        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    location ^~ /c-manager/ {
        proxy_pass http://127.0.0.1:8089;
    
        proxy_http_version 1.1;
        
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_set_header X-Forwarded-Prefix /c-manager;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;
        
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    location ^~ /trade-db/ {
        auth_basic "Restricted Access";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:8081;
    
        proxy_http_version 1.1;
        
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_set_header X-Forwarded-Prefix /trade-db;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;
        
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    # API dev (срезаем префикс /trade-dev-api -> upstream /)
    location ^~ /trade-dev-api/ {
        proxy_pass http://127.0.0.1:3011/;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-Prefix /trade-dev-api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }
    # Web dev (не срезаем префикс, чтобы Next.js базовый путь /trade-dev работал)
    location ^~ /trade-dev {
        proxy_pass http://127.0.0.1:3013;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }
    # (опционально) dev sqlite-web
    location ^~ /trade-dev-db/ {
        auth_basic "Restricted Access";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-Prefix /trade-dev-db;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/qwalex.ru/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/qwalex.ru/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}


server {
    if ($host = dev.qwalex.ru) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name dev.qwalex.ru;
    return 404; # managed by Certbot


}
