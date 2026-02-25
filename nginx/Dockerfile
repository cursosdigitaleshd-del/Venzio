FROM nginx:alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
# Copiar archivos estáticos
COPY contact /usr/share/nginx/html/contact
COPY login /usr/share/nginx/html/login
COPY prices /usr/share/nginx/html/prices
COPY register /usr/share/nginx/html/register
COPY user /usr/share/nginx/html/user
COPY widget /usr/share/nginx/html/widget
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
