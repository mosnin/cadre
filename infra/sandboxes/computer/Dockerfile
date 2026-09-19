FROM debian:bookworm-slim AS capture-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libx11-dev \
    libxdamage-dev \
    libxext-dev \
    libxfixes-dev \
    libxtst-dev \
    libpng-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY xcapture.c .
RUN cc -O3 -fPIC -shared -Wall -Wextra -Werror -o libcadre-xcapture.so xcapture.c \
    -lX11 -lXext -lXdamage -lXfixes -lXtst -lpng

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    pcmanfm \
    mousepad \
    tint2 \
    git \
    curl \
    unzip \
    python3-pip \
    python3-venv \
    xdotool \
    x11-utils \
    x11-xserver-utils \
    imagemagick \
    feh \
    librsvg2-bin \
    x11-apps \
    adwaita-icon-theme \
    novnc \
    websockify \
    python3 \
    ca-certificates \
    procps \
    bash \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-core \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    dbus-x11 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 cadre \
  && useradd --uid 1000 --gid cadre --create-home --shell /bin/bash cadre \
  && mkdir -p /etc/cadre/fluxbox \
  && ln -sfn /bin/true /usr/bin/xmessage
ENV XCURSOR_THEME=Cadre XCURSOR_SIZE=24
ENV DISPLAY=:1
ENV HOME=/home/cadre
WORKDIR /home/cadre
# --chmod normalizes modes: a restrictive host umask (e.g. 077 on hardened hosts) would
# otherwise leave these files unreadable to USER 1000 at runtime.
COPY --chmod=644 wallpaper.svg cursor.svg /usr/share/cadre/
COPY --chmod=755 build-appearance.sh /usr/local/bin/cadre-build-appearance
COPY --chmod=755 desktop-appearance.sh /usr/local/bin/cadre-desktop-appearance
RUN cadre-build-appearance \
  && ln -sfn /usr/local/bin/cadre-desktop-appearance /usr/bin/fbsetbg
COPY --chmod=755 start.sh /usr/local/bin/cadre-computer
COPY --chmod=755 control.py /usr/local/bin/cadre-computer-control
COPY --from=capture-builder /build/libcadre-xcapture.so /usr/local/lib/libcadre-xcapture.so
COPY --chmod=755 cadre-browser /usr/local/bin/cadre-browser
COPY --chmod=644 cadre-browser.desktop /usr/share/applications/cadre-browser.desktop
COPY --chmod=644 fluxbox.init /etc/cadre/fluxbox/init
COPY --chmod=644 fluxbox.apps /etc/cadre/fluxbox/apps
COPY --chmod=644 fluxbox.menu /etc/cadre/fluxbox/menu
COPY --chmod=644 viewer-connection.js /usr/share/novnc/viewer-connection.js
COPY --chmod=644 embed.html /usr/share/novnc/embed.html
COPY --chmod=644 mobile-controls.js /usr/share/novnc/mobile-controls.js
COPY --chmod=644 touch-navigation.js /usr/share/novnc/touch-navigation.js
COPY --chmod=644 tint2rc /etc/cadre/tint2rc
COPY --chmod=644 clipboard-bridge.js /usr/share/novnc/clipboard-bridge.js
# Strip CR so shebangs work even if the build context came from a CRLF checkout.
RUN ldconfig \
  && sed -i 's/\r$//' /usr/local/bin/cadre-computer /usr/local/bin/cadre-computer-control /usr/local/bin/cadre-browser \
    /etc/cadre/fluxbox/init /etc/cadre/fluxbox/apps /etc/cadre/fluxbox/menu
EXPOSE 7070 6080 6081 6082 6083 6084 6085 6086 6087 6088 6089 6090 6091 6092 6093 6094 6095
USER 1000:1000
CMD ["/usr/local/bin/cadre-computer"]
