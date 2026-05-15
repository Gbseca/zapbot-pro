#!/bin/bash
curl -s "https://www.duckdns.org/update?domains=mooverjadm&token=9ffba220-096d-46bc-8239-d372b6a5fe8d&ip="
echo "*/5 * * * * curl -s 'https://www.duckdns.org/update?domains=mooverjadm&token=9ffba220-096d-46bc-8239-d372b6a5fe8d&ip=' >/dev/null 2>&1" | crontab -
sudo apt update
sudo apt install -y nginx
sudo bash -c 'cat > /etc/nginx/sites-available/default <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name mooverjadm.duckdns.org;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF'
sudo systemctl restart nginx
