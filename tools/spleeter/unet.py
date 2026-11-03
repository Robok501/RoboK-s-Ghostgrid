"""Spleeter 4stems U-Nets rebuilt from Deezer's checkpoint (inference only), returning the drums soft mask."""
import numpy as np, tensorflow as tf

def load(ckpt):
    r = tf.train.load_checkpoint(ckpt)
    return {k: r.get_tensor(k) for k in r.get_variable_to_shape_map() if k != 'global_step'}

def build(W, eps=1e-10, bn_eps=1e-3):
    def conv(x, name, stride, dil=1):
        y = tf.nn.conv2d(x, W[name + '/kernel'], strides=stride, padding='SAME', dilations=dil)
        return tf.nn.bias_add(y, W[name + '/bias'])
    def convt(x, name):
        k = W[name + '/kernel']  # [h, w, out, in]
        n, h, w, _ = x.shape
        y = tf.nn.conv2d_transpose(x, k, output_shape=[tf.shape(x)[0], x.shape[1] * 2, x.shape[2] * 2, k.shape[2]], strides=2, padding='SAME')
        return tf.nn.bias_add(y, W[name + '/bias'])
    def bn(x, i):
        n = 'batch_normalization' + ('' if i == 0 else '_%d' % i)
        return tf.nn.batch_normalization(x, W[n + '/moving_mean'], W[n + '/moving_variance'], W[n + '/beta'], W[n + '/gamma'], bn_eps)
    def unet(x, k):
        c = lambda j: 'conv2d' + ('' if 7 * k + j == 0 else '_%d' % (7 * k + j))
        t = lambda j: 'conv2d_transpose' + ('' if 6 * k + j == 0 else '_%d' % (6 * k + j))
        b = lambda j: bn(j and 0 or 0, 0) if False else None
        convs, h = [], x
        for j in range(6):
            cv = conv(h, c(j), 2); convs.append(cv)
            h = bn(cv, 12 * k + j)
            if j < 5: h = tf.nn.elu(h)
        for j in range(6):
            u = tf.nn.elu(convt(h, t(j)))
            h = bn(u, 12 * k + 6 + j)
            if j < 5: h = tf.concat([convs[4 - j], h], axis=3)
        out = tf.sigmoid(conv(h, c(6), 1, dil=2))
        return out * x
    @tf.function(input_signature=[tf.TensorSpec([None, 512, 1024, 2], tf.float32, name='mag')])
    def drums_mask(x):
        est = [unet(x, k) for k in range(4)]            # vocals, drums, bass, other
        sq = [e * e for e in est]
        den = sq[0] + sq[1] + sq[2] + sq[3] + eps
        return tf.identity((sq[1] + eps / 4.0) / den, name='drums_mask')
    return drums_mask
