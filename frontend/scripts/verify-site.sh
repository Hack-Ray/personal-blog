#!/bin/sh
# Usage: verify-site.sh <base-url>   e.g. http://127.0.0.1:8123/personal-blog
B=$1; fails=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
body() { curl -s "$1"; }
check "home lists newest post first" '[ "$(body $B/ | grep -o "/personal-blog/posts/01K7[A-Z0-9]*/" | head -1)" = "/personal-blog/posts/01K7P2B9X3QW8N5R7TZ4HJMVCD/" ]'
check "published post renders markdown" 'body $B/posts/01K7M4Y7P65BDCF8AHRTQY7ZQF/ | grep -q "<h2>為什麼自建 CMS</h2>"'
check "published post is indexable" '! body $B/posts/01K7M4Y7P65BDCF8AHRTQY7ZQF/ | grep -q noindex'
check "archived post shows archive notice" 'body $B/posts/01K6ZT3H5J7K9M1N3P5Q7R9S1T/ | grep -q "<h1>文章已封存</h1>"'
check "archived post is noindex" 'body $B/posts/01K6ZT3H5J7K9M1N3P5Q7R9S1T/ | grep -q "noindex"'
check "archived post absent from list" '! body $B/posts/ | grep -q 01K6ZT3H5J7K9M1N3P5Q7R9S1T'
check "unknown docId is not generated" '[ "$(code $B/posts/01K7ZZZZZZZZZZZZZZZZZZZZZZ/)" = 404 ]'
check "topic page lists only its posts" 'p=$(body $B/topics/backend/); echo "$p" | grep -q 01K7R6F2M8KD4S9V1YCX3BNQWE && ! echo "$p" | grep -q 01K7P2B9X3QW8N5R7TZ4HJMVCD'
check "tag page lists tagged posts" 'body $B/tags/python/ | grep -q 01K7M4Y7P65BDCF8AHRTQY7ZQF'
check "assets resolve under basePath" 'a=$(body $B/ | grep -o "/personal-blog/_next/static/[^\"]*\.css" | head -1); [ -n "$a" ] && [ "$(curl -s -o /dev/null -w %{http_code} "${B%/personal-blog}$a")" = 200 ]'
check "snapshot image is served under basePath" 'i=$(body $B/posts/01K7M4Y7P65BDCF8AHRTQY7ZQF/ | grep -o "src=\"/personal-blog/images/[^\"]*" | head -1 | cut -d\" -f2); [ -n "$i" ] && [ "$(curl -s -o /dev/null -w %{http_code} "${B%/personal-blog}$i")" = 200 ]'
check "article list shows the first uploaded image and an excerpt" 'p=$(body $B/posts/); echo "$p" | grep -q "class=\"thumbnail\" src=\"/personal-blog/images/" && echo "$p" | grep -q "class=\"excerpt\""'
check "sitemap lists published posts with absolute URLs" 'body $B/sitemap.xml | grep -q "<loc>https://hack-ray.github.io/personal-blog/posts/01K7M4Y7P65BDCF8AHRTQY7ZQF/</loc>"'
check "sitemap leaves out archived posts" '! body $B/sitemap.xml | grep -q 01K6ZT3H5J7K9M1N3P5Q7R9S1T'
check "post has a canonical URL" 'body $B/posts/01K7M4Y7P65BDCF8AHRTQY7ZQF/ | grep -q "rel=\"canonical\" href=\"https://hack-ray.github.io/personal-blog/posts/01K7M4Y7P65BDCF8AHRTQY7ZQF/\""'
check "about page links to GitHub" 'body $B/about/ | grep -q "href=\"https://github.com/Hack-Ray\""'
check "search index excludes archived posts" '! body $B/search-index.json | grep -q 01K6ZT3H5J7K9M1N3P5Q7R9S1T'
check "header search form submits q to the search page" 'f=$(body $B/ | grep -o "<form role=\"search\"[^>]*>.*</form>"); echo "$f" | grep -q "action=\"/personal-blog/search/\"" && echo "$f" | grep -q "name=\"q\""'
check "header title links home and home has a single h1" 'body $B/ | grep -q "class=\"site-title\" href=\"/personal-blog/\"" && [ "$(body $B/ | grep -o "<h1" | wc -l)" = 1 ]'
check "404.html exists for GitHub Pages" '[ "$(code $B/404.html)" = 200 ]'
echo "failures=$fails"; [ $fails = 0 ]
